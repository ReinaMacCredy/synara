import { describe, expect, it } from "vitest";
import {
  AssignmentId,
  ContextBundleId,
  ProjectTaskId,
  ThreadId,
  type AssignmentContract,
} from "@synara/contracts";

import {
  projectOrchestratorSidebarChildren,
  visibleOrchestratorSidebarChildren,
} from "./orchestratorSidebarProjection";

const root = ThreadId.makeUnsafe("root");
const child = (id: string, parentThreadId: ThreadId = root) => ({
  id: ThreadId.makeUnsafe(id),
  parentThreadId,
  createdAt: "2026-08-02T10:00:00.000Z",
});
const assignment = (
  id: string,
  assigneeThreadId: ThreadId,
  state: AssignmentContract["state"],
  version = 1,
): AssignmentContract => ({
  assignmentId: AssignmentId.makeUnsafe(id),
  version,
  taskId: ProjectTaskId.makeUnsafe(`task-${id}`),
  ownerThreadId: root,
  assigneeThreadId,
  goal: "demo",
  acceptanceCriteria: [],
  immutableUserConstraints: [],
  workingAssumptions: [],
  contextBundleId: ContextBundleId.makeUnsafe(`context-${id}`),
  continuity: { kind: "reuse", threadId: assigneeThreadId },
  modelTarget: {
    provider: "codex",
    model: "gpt-5.6-luna",
    runtimeMode: "approval-required",
    workspaceRoot: "/tmp/demo",
  },
  decisionReason: {
    summary: "demo",
    taskFit: [],
    contextHealth: "healthy",
    cacheEconomics: "reuse",
    selectedAt: "2026-08-02T10:00:00.000Z",
  },
  pathOwnershipClaims: [],
  dependencyRefs: [],
  expectedApis: [],
  allowedCapabilities: [],
  evidenceRequirements: [],
  verifierClass: "root",
  state,
  supersedesVersion: null,
  createdAt: "2026-08-02T10:00:00.000Z",
  updatedAt: `2026-08-02T10:00:0${version}.000Z`,
});

describe("projectOrchestratorSidebarChildren", () => {
  it("uses canonical assignment lifecycle for Ready, Working, and Available", () => {
    const ready = child("ready");
    const working = child("working");
    const idle = child("idle");
    const projected = projectOrchestratorSidebarChildren({
      rootThreadId: root,
      threads: [ready, working, idle],
      assignments: [
        assignment("ready", ready.id, "reported_complete"),
        assignment("working", working.id, "running"),
      ],
    });

    expect(projected.map((entry) => [entry.thread.id, entry.lane])).toEqual([
      [ready.id, "ready"],
      [working.id, "working"],
      [idle.id, "available"],
    ]);
  });

  it("keeps all actionable children and limits only Available to three", () => {
    const children = [child("ready"), child("working"), ...[1, 2, 3, 4].map((n) => child(`a${n}`))];
    const projected = projectOrchestratorSidebarChildren({
      rootThreadId: root,
      threads: children,
      assignments: [
        assignment("ready", children[0]!.id, "verified"),
        assignment("working", children[1]!.id, "blocked"),
      ],
    });

    expect(visibleOrchestratorSidebarChildren(projected)).toHaveLength(5);
  });
});
