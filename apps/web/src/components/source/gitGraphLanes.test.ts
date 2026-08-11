import { describe, expect, it } from "vitest";

import { assignGitGraphLanes } from "./gitGraphLanes";

describe("assignGitGraphLanes", () => {
  it("keeps a linear history on a single lane", () => {
    const rows = assignGitGraphLanes([
      { sha: "c", parents: ["b"] },
      { sha: "b", parents: ["a"] },
      { sha: "a", parents: [] },
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.every((row) => !row.isMerge)).toBe(true);
  });

  it("opens a side lane for a non-first parent merge", () => {
    const rows = assignGitGraphLanes([
      { sha: "m", parents: ["a", "b"] },
      { sha: "b", parents: ["root"] },
      { sha: "a", parents: ["root"] },
      { sha: "root", parents: [] },
    ]);
    expect(rows[0]?.isMerge).toBe(true);
    expect(rows[0]?.lane).toBe(0);
    expect(rows[0]?.parentLanes[0]).toBe(0);
    expect(rows[0]?.parentLanes[1]).toBe(1);
    expect(rows[1]?.lane).toBe(1);
    expect(rows[2]?.lane).toBe(0);
  });
});
