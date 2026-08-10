import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type {
  SupervisorNotebookCompactionReceipt,
  SupervisorNotebookEntry,
} from "@synara/contracts";

import {
  buildSupervisorNotebookView,
  planSupervisorNotebookCompaction,
} from "./SharedSupervisorNotebook.ts";

const now = "2026-08-09T00:00:00.000Z";
const entry = (
  id: string,
  overrides: Partial<SupervisorNotebookEntry> = {},
): SupervisorNotebookEntry =>
  ({
    id,
    workspaceId: "workspace:stage-5",
    roomId: "room:stage-5",
    taskNodeId: null,
    concern: "delivery",
    authorSeatId: "seat:supervisor",
    kind: "observation",
    content: `content:${id}`,
    evidenceRefs: [],
    confidence: 0.9,
    supersedesEntryId: null,
    protectionClass: "workspace",
    redactedAt: null,
    createdAt: now,
    ...overrides,
  }) as SupervisorNotebookEntry;

const build = (
  entries: ReadonlyArray<SupervisorNotebookEntry>,
  compactionReceipts: ReadonlyArray<SupervisorNotebookCompactionReceipt> = [],
) =>
  buildSupervisorNotebookView({
    workspaceId: "workspace:stage-5" as SupervisorNotebookEntry["workspaceId"],
    viewerSeatId: "seat:supervisor" as SupervisorNotebookEntry["authorSeatId"],
    entries,
    compactionReceipts,
    cursor: null,
    allowedProtectionClasses: ["workspace"],
    limit: 20,
    createdAt: now,
  });

describe("shared supervisor notebook projections", () => {
  it("keeps workspace, protection, supersession, and per-seat cursor boundaries", () => {
    const original = entry("original", { createdAt: "2026-08-08T00:00:00.000Z" });
    const replacement = entry("replacement", {
      supersedesEntryId: original.id,
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    const otherWorkspace = entry("other-workspace", { workspaceId: "workspace:other" });
    const protectedEntry = entry("protected", { protectionClass: "secret" });

    const first = build([original, replacement, otherWorkspace, protectedEntry]);
    assert.deepEqual(
      first.entries.map((candidate) => candidate.id),
      [replacement.id],
    );

    const newer = entry("newer", { createdAt: "2026-08-10T00:00:00.000Z" });
    const incremental = buildSupervisorNotebookView({
      workspaceId: first.workspaceId,
      viewerSeatId: first.viewerSeatId,
      entries: [original, replacement, newer],
      compactionReceipts: [],
      cursor: first.nextCursor,
      allowedProtectionClasses: ["workspace"],
      limit: 20,
      createdAt: "2026-08-10T00:00:01.000Z",
    });
    assert.deepEqual(
      incremental.entries.map((candidate) => candidate.id),
      [newer.id],
    );
  });

  it("retains source evidence and does not hide sources behind an inaccessible summary", () => {
    const sourceA = entry("source-a", { evidenceRefs: ["evidence:a"] });
    const sourceB = entry("source-b", { evidenceRefs: ["evidence:b"] });
    const planned = planSupervisorNotebookCompaction({
      entries: [sourceA, sourceB],
      sourceEntryIds: [sourceA.id, sourceB.id],
      authorSeatId: sourceA.authorSeatId,
      content: "Durable summary",
      createdAt: now,
    });

    const visible = build([sourceA, sourceB, planned.summaryEntry], [planned.receipt]);
    assert.deepEqual(
      visible.entries.map((candidate) => candidate.id),
      [planned.summaryEntry.id],
    );
    assert.deepEqual(planned.summaryEntry.evidenceRefs, ["evidence:a", "evidence:b"]);
    assert.deepEqual(planned.receipt.sourceEntryIds, [sourceA.id, sourceB.id]);

    const hiddenSummary = { ...planned.summaryEntry, protectionClass: "secret" };
    const protectedView = build([sourceA, sourceB, hiddenSummary], [planned.receipt]);
    assert.deepEqual(
      new Set(protectedView.entries.map((candidate) => candidate.id)),
      new Set([sourceA.id, sourceB.id]),
    );
    assert.deepEqual(protectedView.compactionReceipts, []);

    const hiddenSource = { ...sourceA, protectionClass: "secret" };
    const sourceProtectedView = build(
      [hiddenSource, sourceB, planned.summaryEntry],
      [planned.receipt],
    );
    assert.deepEqual(sourceProtectedView.compactionReceipts, []);
  });

  it("preserves TaskNode scope, evidence lineage, and idempotent compaction identity", () => {
    const sourceA = entry("source-a", {
      taskNodeId: "task-node:review" as never,
      evidenceRefs: ["evidence:z", "evidence:a"],
    });
    const sourceB = entry("source-b", {
      taskNodeId: "task-node:review" as never,
      evidenceRefs: ["evidence:a", "evidence:b"],
    });
    const first = planSupervisorNotebookCompaction({
      entries: [sourceA, sourceB],
      sourceEntryIds: [sourceB.id, sourceA.id],
      authorSeatId: "seat:successor" as SupervisorNotebookEntry["authorSeatId"],
      content: "Durable TaskNode-scoped summary",
      createdAt: "2026-08-09T00:02:00.000Z",
    });
    const retry = planSupervisorNotebookCompaction({
      entries: [sourceB, sourceA],
      sourceEntryIds: [sourceA.id, sourceB.id, sourceA.id],
      authorSeatId: "seat:successor" as SupervisorNotebookEntry["authorSeatId"],
      content: "Durable TaskNode-scoped summary",
      createdAt: "2026-08-09T00:03:00.000Z",
    });

    assert.equal(first.summaryEntry.taskNodeId, sourceA.taskNodeId);
    assert.deepEqual(first.summaryEntry.evidenceRefs, ["evidence:a", "evidence:b", "evidence:z"]);
    assert.deepEqual(first.receipt.evidenceRefs, first.summaryEntry.evidenceRefs);
    assert.deepEqual(first.receipt.sourceEntryIds, [sourceA.id, sourceB.id]);
    assert.equal(retry.summaryEntry.id, first.summaryEntry.id);
    assert.equal(retry.receipt.id, first.receipt.id);
  });

  it("gives a successor Supervisor only the requested scoped NotebookView", () => {
    const priorSupervisorEntry = entry("prior-supervisor-task", {
      authorSeatId: "seat:supervisor-prior" as never,
      taskNodeId: "task-node:visible" as never,
    });
    const successorEntry = entry("successor-task", {
      authorSeatId: "seat:supervisor-successor" as never,
      taskNodeId: "task-node:visible" as never,
      createdAt: "2026-08-09T00:01:00.000Z",
    });
    const otherTask = entry("other-task", {
      taskNodeId: "task-node:hidden" as never,
      createdAt: "2026-08-09T00:02:00.000Z",
    });
    const otherRoom = entry("other-room", {
      roomId: "room:hidden" as never,
      taskNodeId: "task-node:visible" as never,
      createdAt: "2026-08-09T00:03:00.000Z",
    });

    const view = buildSupervisorNotebookView({
      workspaceId: priorSupervisorEntry.workspaceId,
      viewerSeatId: "seat:supervisor-successor" as never,
      entries: [otherRoom, otherTask, priorSupervisorEntry, successorEntry],
      compactionReceipts: [],
      cursor: null,
      roomId: priorSupervisorEntry.roomId!,
      taskNodeId: priorSupervisorEntry.taskNodeId!,
      allowedProtectionClasses: ["workspace"],
      limit: 20,
      createdAt: "2026-08-09T00:04:00.000Z",
    });

    assert.equal(view.viewerSeatId, "seat:supervisor-successor");
    assert.deepEqual(
      view.entries.map((candidate) => [candidate.id, candidate.authorSeatId]),
      [
        [successorEntry.id, successorEntry.authorSeatId],
        [priorSupervisorEntry.id, priorSupervisorEntry.authorSeatId],
      ],
    );
    assert.equal("rootLeaseIds" in view, false);
  });

  it("rejects a predecessor cursor for a successor Supervisor", () => {
    const source = entry("source");
    assert.throws(
      () =>
        buildSupervisorNotebookView({
          workspaceId: source.workspaceId,
          viewerSeatId: "seat:successor" as never,
          entries: [source],
          compactionReceipts: [],
          cursor: {
            id: "cursor:predecessor" as never,
            workspaceId: source.workspaceId,
            seatId: "seat:predecessor" as never,
            lastCreatedAt: source.createdAt,
            lastEntryId: source.id,
            updatedAt: source.createdAt,
          },
          allowedProtectionClasses: ["workspace"],
          limit: 20,
          createdAt: now,
        }),
      /cannot cross workspace or AgentSeat scope/,
    );
  });

  it("rejects compaction across notebook workspace boundaries", () => {
    const sourceA = entry("source-a");
    const sourceB = entry("source-b", { workspaceId: "workspace:other" });
    assert.throws(
      () =>
        planSupervisorNotebookCompaction({
          entries: [sourceA, sourceB],
          sourceEntryIds: [sourceA.id, sourceB.id],
          authorSeatId: sourceA.authorSeatId,
          content: "Invalid cross-workspace summary",
          createdAt: now,
        }),
      /cannot cross workspace boundaries/,
    );
  });

  it("rejects compaction that would widen Room, TaskNode, or protection visibility", () => {
    const source = entry("source");
    for (const other of [
      entry("other-room", { roomId: "room:other" }),
      entry("other-task", { taskNodeId: "task-node:other" as never }),
      entry("other-protection", { protectionClass: "internal" }),
    ]) {
      assert.throws(() =>
        planSupervisorNotebookCompaction({
          entries: [source, other],
          sourceEntryIds: [source.id, other.id],
          authorSeatId: source.authorSeatId,
          content: "Invalid widened summary",
          createdAt: now,
        }),
      );
    }
  });
});
