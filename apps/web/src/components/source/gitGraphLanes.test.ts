import { describe, expect, it } from "vitest";

import { assignGitGraphLanes, maxGitGraphLane } from "./gitGraphLanes";

describe("assignGitGraphLanes", () => {
  it("keeps a linear history on one lane with top/bottom edges", () => {
    const rows = assignGitGraphLanes([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.every((row) => !row.isMerge)).toBe(true);
    // Newest tip: no edge from above, only node → parent.
    expect(rows[0]?.edges.some((e) => e.fromY === 0 && e.toY === 0.5)).toBe(false);
    expect(rows[0]?.edges.some((e) => e.fromY === 0.5 && e.toY === 1)).toBe(true);
    // Middle: line in from above and out below.
    expect(rows[1]?.edges.some((e) => e.fromY === 0 && e.toY === 0.5)).toBe(true);
    expect(rows[1]?.edges.some((e) => e.fromY === 0.5 && e.toY === 1)).toBe(true);
    // Root: only from above, no parent out.
    expect(rows[2]?.edges.some((e) => e.fromY === 0.5 && e.toY === 1)).toBe(false);
    expect(maxGitGraphLane(rows)).toBe(0);
  });

  it("forks a second parent onto another lane", () => {
    const rows = assignGitGraphLanes([
      { sha: "m", parents: ["a", "b"] },
      { sha: "b", parents: ["root"] },
      { sha: "a", parents: ["root"] },
      { sha: "root", parents: [] },
    ]);
    expect(rows[0]?.isMerge).toBe(true);
    expect(rows[0]?.lane).toBe(0);
    // Fork edge from node to second-parent lane.
    expect(
      rows[0]?.edges.some(
        (e) => e.fromLane === 0 && e.toLane === 1 && e.fromY === 0.5 && e.toY === 1,
      ),
    ).toBe(true);
    expect(rows[1]?.lane).toBe(1);
    expect(maxGitGraphLane(rows)).toBeGreaterThanOrEqual(1);
  });

  it("merges two children of the same parent with a join edge", () => {
    const rows = assignGitGraphLanes([
      { sha: "childA", parents: ["parent"] },
      { sha: "childB", parents: ["parent"] },
      { sha: "parent", parents: [] },
    ]);
    // childA tip on 0, childB tip on 1, parent joins.
    expect(rows[2]?.lane).toBe(0);
    expect(
      rows[2]?.edges.some(
        (e) => e.fromLane === 1 && e.toLane === 0 && e.fromY === 0 && e.toY === 0.5,
      ),
    ).toBe(true);
  });

  it("does not paint a wall of inactive lanes on a simple tip", () => {
    const rows = assignGitGraphLanes([
      { sha: "only", parents: ["root"] },
      { sha: "root", parents: [] },
    ]);
    expect(maxGitGraphLane(rows)).toBe(0);
    expect(rows[0]?.edges.every((e) => e.fromLane === 0 && e.toLane === 0)).toBe(true);
  });
});
