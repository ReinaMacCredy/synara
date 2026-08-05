// FILE: ComposerOrchestratorChildStrip.logic.test.ts
// Purpose: Pins deriveComposerOrchestratorChildStripItems lane counts and labels.

import { describe, expect, it } from "vitest";
import {
  AssignmentId,
  ContextBundleId,
  ProjectTaskId,
  ThreadId,
  type AssignmentContract,
} from "@synara/contracts";

import { deriveComposerOrchestratorChildStripItems } from "./ComposerOrchestratorChildStrip.logic";

const root = ThreadId.makeUnsafe("root");

const child = (id: string, title: string, parentThreadId: ThreadId = root) => ({
  id: ThreadId.makeUnsafe(id),
  title,
  parentThreadId,
  createdAt: "2026-08-02T10:00:00.000Z",
});

const assignment = (
  id: string,
  assigneeThreadId: ThreadId,
  state: AssignmentContract["state"],
): AssignmentContract => ({
  assignmentId: AssignmentId.makeUnsafe(id),
  version: 1,
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
  updatedAt: "2026-08-02T10:00:01.000Z",
});

describe("deriveComposerOrchestratorChildStripItems", () => {
  it("returns empty when the root has no children", () => {
    const model = deriveComposerOrchestratorChildStripItems({
      rootThreadId: root,
      threads: [{ id: root, title: "Root", parentThreadId: null, createdAt: "2026-08-02T09:00:00.000Z" }],
      assignments: [],
    });
    expect(model.items).toEqual([]);
    expect(model.counts).toEqual({ ready: 0, working: 0, available: 0, blocked: 0 });
  });

  it("maps assignment lifecycle into strip rows with counts", () => {
    const ready = child("ready", "fix session race");
    const working = child("working", "migrate tokens");
    const blocked = child("blocked", "db migration");
    const idle = child("idle", "docs pass");

    const model = deriveComposerOrchestratorChildStripItems({
      rootThreadId: root,
      threads: [ready, working, blocked, idle],
      assignments: [
        assignment("ready", ready.id, "verified"),
        assignment("working", working.id, "running"),
        assignment("blocked", blocked.id, "blocked"),
      ],
      viewedThreadId: working.id,
    });

    expect(model.items.map((item) => [item.title, item.statusKind, item.isViewed])).toEqual([
      ["fix session race", "ready", false],
      ["db migration", "blocked", false],
      ["migrate tokens", "running", true],
      ["docs pass", "available", false],
    ]);
    expect(model.counts).toEqual({ ready: 1, working: 2, available: 1, blocked: 1 });
  });

  it("falls back to thread id when title is blank", () => {
    const bare = child("bare-child", "   ");
    const model = deriveComposerOrchestratorChildStripItems({
      rootThreadId: root,
      threads: [bare],
      assignments: [],
    });
    expect(model.items).toHaveLength(1);
    expect(model.items[0]?.title).toBe(bare.id);
    expect(model.items[0]?.statusKind).toBe("available");
  });

  it("does not list Advisor children of other roots as this root's strip rows", () => {
    const otherRoot = ThreadId.makeUnsafe("other-root");
    const foreignAdvisor = child("adv-1", "Advisor: Question", otherRoot);
    const model = deriveComposerOrchestratorChildStripItems({
      rootThreadId: root,
      threads: [
        { id: root, title: "Hello", parentThreadId: null, createdAt: "2026-08-02T09:00:00.000Z" },
        foreignAdvisor,
      ],
      assignments: [],
    });
    expect(model.items).toEqual([]);
  });

  it("includes synara_mcp children linked only via sourceThreadId (Sidebar containment)", () => {
    const childA = {
      id: ThreadId.makeUnsafe("child-a"),
      title: "Child A",
      parentThreadId: null as ThreadId | null,
      sourceThreadId: root,
      creationSource: "synara_mcp",
      createdAt: "2026-08-02T10:00:00.000Z",
    };
    const childB = {
      id: ThreadId.makeUnsafe("child-b"),
      title: "Child B",
      parentThreadId: null as ThreadId | null,
      sourceThreadId: root,
      creationSource: "synara_mcp",
      createdAt: "2026-08-02T10:00:01.000Z",
    };
    const unrelated = {
      id: ThreadId.makeUnsafe("orphan"),
      title: "Orphan",
      parentThreadId: null as ThreadId | null,
      sourceThreadId: null as ThreadId | null,
      creationSource: "synara_mcp",
      createdAt: "2026-08-02T10:00:02.000Z",
    };
    const model = deriveComposerOrchestratorChildStripItems({
      rootThreadId: root,
      threads: [
        { id: root, title: "hi", parentThreadId: null, createdAt: "2026-08-02T09:00:00.000Z" },
        childA,
        childB,
        unrelated,
      ],
      assignments: [],
    });
    expect(model.items.map((item) => item.title)).toEqual(["Child B", "Child A"]);
    expect(model.counts.available).toBe(2);
  });

  it("does not treat sourceThreadId as parent when creationSource is ordinary", () => {
    const model = deriveComposerOrchestratorChildStripItems({
      rootThreadId: root,
      threads: [
        { id: root, title: "hi", parentThreadId: null, createdAt: "2026-08-02T09:00:00.000Z" },
        {
          id: ThreadId.makeUnsafe("forked"),
          title: "Forked chat",
          parentThreadId: null,
          sourceThreadId: root,
          creationSource: "user",
          createdAt: "2026-08-02T10:00:00.000Z",
        },
      ],
      assignments: [],
    });
    expect(model.items).toEqual([]);
  });
});
