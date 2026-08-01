import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import {
  collectOrchestratorThreadIds,
  partitionThreadsByOrchestratorMembership,
  sortOrchestratorRoots,
} from "./orchestratorRoots";

const root = (id: string, createdAt: string, archivedAt: string | null = null) => ({
  rootThreadId: ThreadId.makeUnsafe(id),
  projectId: ProjectId.makeUnsafe("project"),
  protocolVersion: 1 as const,
  state: archivedAt ? ("archived" as const) : ("active" as const),
  activeProcessId: null,
  resourcePolicyVersion: 1,
  createdAt,
  archivedAt,
  revision: 0,
});

describe("orchestratorRoots", () => {
  it("collects roots and transitive descendants without hiding unrelated threads", () => {
    const rootId = ThreadId.makeUnsafe("root");
    const childId = ThreadId.makeUnsafe("child");
    const grandchildId = ThreadId.makeUnsafe("grandchild");
    const ordinaryId = ThreadId.makeUnsafe("ordinary");
    const threads = [
      { id: rootId, parentThreadId: null },
      { id: childId, parentThreadId: rootId },
      { id: grandchildId, parentThreadId: childId },
      { id: ordinaryId, parentThreadId: null },
    ];

    const ids = collectOrchestratorThreadIds([root("root", "2026-01-01T00:00:00.000Z")], threads);
    expect([...ids]).toEqual([rootId, childId, grandchildId]);
    expect(partitionThreadsByOrchestratorMembership(threads, ids)).toEqual({
      ordinaryThreads: [{ id: ordinaryId, parentThreadId: null }],
      orchestratorThreads: threads.slice(0, 3),
    });
  });

  it("sorts active and archived roots by their latest lifecycle timestamp", () => {
    expect(
      sortOrchestratorRoots([
        root("older", "2026-01-01T00:00:00.000Z"),
        root("archived", "2026-01-02T00:00:00.000Z", "2026-01-04T00:00:00.000Z"),
        root("newer", "2026-01-03T00:00:00.000Z"),
      ]).map((item) => item.rootThreadId),
    ).toEqual(["archived", "newer", "older"]);
  });
});
