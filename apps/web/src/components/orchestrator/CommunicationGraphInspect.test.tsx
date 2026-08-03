import { ThreadId, type OrchestratorOwnershipEdge } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { ownershipRoutesForSelection } from "./orchestratorViewModel";

const ROOT = ThreadId.makeUnsafe("root-a");
const CHILD_B = ThreadId.makeUnsafe("child-b");
const CHILD_C = ThreadId.makeUnsafe("child-c");
const CHILD_D = ThreadId.makeUnsafe("child-d");
const UNATTACHED = ThreadId.makeUnsafe("child-unattached");

function edge(
  parentThreadId: typeof ROOT,
  childThreadId: typeof ROOT,
  retiredAt: string | null = null,
): OrchestratorOwnershipEdge {
  return {
    parentThreadId,
    childThreadId,
    activeFrom: "2026-08-02T00:00:00.000Z",
    retiredAt,
  } as OrchestratorOwnershipEdge;
}

describe("communication ownership-route projection", () => {
  const edges = [
    edge(ROOT, CHILD_B),
    edge(ROOT, CHILD_C),
    edge(CHILD_B, CHILD_D),
    edge(ROOT, ThreadId.makeUnsafe("retired-child"), "2026-08-02T01:00:00.000Z"),
  ];

  it("shows active directly owned children when the Root is selected", () => {
    expect(ownershipRoutesForSelection(ROOT, ROOT, edges)).toEqual([edges[0], edges[1]]);
  });

  it("shows active parent and child routes touching a selected descendant", () => {
    expect(ownershipRoutesForSelection(ROOT, CHILD_B, edges)).toEqual([edges[0], edges[2]]);
    expect(ownershipRoutesForSelection(ROOT, CHILD_C, edges)).toEqual([edges[1]]);
  });

  it("does not present retired ownership as current communication reachability", () => {
    expect(
      ownershipRoutesForSelection(ROOT, ROOT, edges).some((route) => route.retiredAt !== null),
    ).toBe(false);
  });

  it("does not invent a route for an unattached or out-of-scope thread", () => {
    expect(ownershipRoutesForSelection(ROOT, UNATTACHED, edges)).toEqual([]);
  });
});
