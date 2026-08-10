import { createHash } from "node:crypto";

import {
  SupervisorNotebookCompactionReceiptId,
  SupervisorNotebookCursorId,
  SupervisorNotebookEntryId,
  type SupervisorNotebookCompactionReceipt,
  type SupervisorNotebookCursor,
  type SupervisorNotebookEntry,
  type SupervisorNotebookView,
} from "@synara/contracts";

const cursorId = (workspaceId: string, seatId: string) =>
  SupervisorNotebookCursorId.makeUnsafe(
    `notebook-cursor:${createHash("sha256")
      .update(`${workspaceId}\u0000${seatId}`)
      .digest("hex")
      .slice(0, 32)}`,
  );

const compactionIdentity = (input: {
  readonly workspaceId: string;
  readonly roomId: string | null;
  readonly taskNodeId: string | null;
  readonly sourceEntryIds: ReadonlyArray<string>;
  readonly authorSeatId: string;
  readonly content: string;
}) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        roomId: input.roomId,
        taskNodeId: input.taskNodeId,
        sourceEntryIds: input.sourceEntryIds,
        authorSeatId: input.authorSeatId,
        content: input.content,
      }),
    )
    .digest("hex");

export interface BuildSupervisorNotebookViewInput {
  readonly workspaceId: SupervisorNotebookEntry["workspaceId"];
  readonly viewerSeatId: SupervisorNotebookEntry["authorSeatId"];
  readonly entries: ReadonlyArray<SupervisorNotebookEntry>;
  readonly compactionReceipts: ReadonlyArray<SupervisorNotebookCompactionReceipt>;
  readonly cursor: SupervisorNotebookCursor | null;
  readonly roomId?: string;
  readonly taskNodeId?: string;
  readonly concern?: string;
  readonly allowedProtectionClasses: ReadonlyArray<string>;
  readonly limit: number;
  readonly createdAt: string;
}

export function buildSupervisorNotebookView(
  input: BuildSupervisorNotebookViewInput,
): SupervisorNotebookView {
  if (
    input.cursor &&
    (input.cursor.workspaceId !== input.workspaceId || input.cursor.seatId !== input.viewerSeatId)
  ) {
    throw new Error("A Supervisor Notebook cursor cannot cross workspace or AgentSeat scope.");
  }
  const protectionClasses = new Set(input.allowedProtectionClasses);
  const cursorBoundary = input.cursor
    ? `${input.cursor.lastCreatedAt ?? ""}\u0000${input.cursor.lastEntryId ?? ""}`
    : null;
  const scopedEntries = input.entries.filter((entry) => {
    if (entry.workspaceId !== input.workspaceId || entry.redactedAt !== null) return false;
    if (!protectionClasses.has(entry.protectionClass)) return false;
    if (input.roomId !== undefined && entry.roomId !== input.roomId) return false;
    if (input.taskNodeId !== undefined && entry.taskNodeId !== input.taskNodeId) return false;
    if (input.concern !== undefined && entry.concern !== input.concern) return false;
    return true;
  });
  const scopedEntryIds = new Set(scopedEntries.map((entry) => entry.id));
  const visibleReceipts = input.compactionReceipts.filter(
    (receipt) =>
      receipt.workspaceId === input.workspaceId &&
      scopedEntryIds.has(receipt.summaryEntryId) &&
      receipt.sourceEntryIds.every((entryId) => scopedEntryIds.has(entryId)),
  );
  const candidates = scopedEntries.filter(
    (entry) =>
      cursorBoundary === null || `${entry.createdAt}\u0000${entry.id}` > cursorBoundary,
  );
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const supersededIds = new Set(
    candidates.flatMap((entry) => (entry.supersedesEntryId === null ? [] : [entry.supersedesEntryId])),
  );
  const compactedIds = new Set(
    visibleReceipts.flatMap((receipt) =>
      receipt.workspaceId === input.workspaceId && candidateIds.has(receipt.summaryEntryId)
        ? receipt.sourceEntryIds
        : [],
    ),
  );
  const orderedCandidates = candidates.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
  const entries = orderedCandidates
    .filter((entry) => !supersededIds.has(entry.id) && !compactedIds.has(entry.id))
    .slice(0, Math.max(1, Math.min(input.limit, 512)));
  const newest = orderedCandidates[0] ?? null;
  const nextCursor: SupervisorNotebookCursor = {
    id: cursorId(input.workspaceId, input.viewerSeatId),
    workspaceId: input.workspaceId,
    seatId: input.viewerSeatId,
    lastCreatedAt: newest?.createdAt ?? input.cursor?.lastCreatedAt ?? null,
    lastEntryId: newest?.id ?? input.cursor?.lastEntryId ?? null,
    updatedAt: input.createdAt,
  };
  return {
    workspaceId: input.workspaceId,
    viewerSeatId: input.viewerSeatId,
    entries,
    compactionReceipts: visibleReceipts,
    nextCursor,
    createdAt: input.createdAt,
  };
}

export function planSupervisorNotebookCompaction(input: {
  readonly entries: ReadonlyArray<SupervisorNotebookEntry>;
  readonly sourceEntryIds: ReadonlyArray<SupervisorNotebookEntry["id"]>;
  readonly authorSeatId: SupervisorNotebookEntry["authorSeatId"];
  readonly content: string;
  readonly createdAt: string;
}): {
  readonly summaryEntry: SupervisorNotebookEntry;
  readonly receipt: SupervisorNotebookCompactionReceipt;
} {
  if (input.content.length > 32_768) {
    throw new Error("Notebook compaction summary exceeds the durable text limit.");
  }
  if (input.content.trim().length === 0) {
    throw new Error("Notebook compaction requires summary content.");
  }
  const sourceEntryIds = [...new Set(input.sourceEntryIds)].toSorted();
  if (sourceEntryIds.length === 0) throw new Error("Notebook compaction requires source entries.");
  if (sourceEntryIds.length > 512) {
    throw new Error("Notebook compaction cannot exceed 512 source entries.");
  }
  const sources = sourceEntryIds.map((entryId) => {
    const entry = input.entries.find((candidate) => candidate.id === entryId);
    if (!entry) throw new Error(`Notebook compaction source '${entryId}' is unavailable.`);
    return entry;
  });
  const workspaceId = sources[0]!.workspaceId;
  if (sources.some((entry) => entry.workspaceId !== workspaceId)) {
    throw new Error("Notebook compaction cannot cross workspace boundaries.");
  }
  if (sources.some((entry) => entry.roomId !== sources[0]!.roomId)) {
    throw new Error("Notebook compaction cannot cross Room boundaries.");
  }
  if (sources.some((entry) => entry.taskNodeId !== sources[0]!.taskNodeId)) {
    throw new Error("Notebook compaction cannot cross TaskNode boundaries.");
  }
  if (sources.some((entry) => entry.protectionClass !== sources[0]!.protectionClass)) {
    throw new Error("Notebook compaction cannot cross protection classes.");
  }
  if (sources.some((entry) => entry.redactedAt !== null)) {
    throw new Error("Notebook compaction cannot summarize redacted source entries.");
  }
  const evidenceRefs = [...new Set(sources.flatMap((entry) => entry.evidenceRefs))].toSorted();
  const identity = compactionIdentity({
    workspaceId,
    roomId: sources[0]!.roomId,
    taskNodeId: sources[0]!.taskNodeId,
    sourceEntryIds,
    authorSeatId: input.authorSeatId,
    content: input.content,
  });
  const summaryEntry: SupervisorNotebookEntry = {
    id: SupervisorNotebookEntryId.makeUnsafe(`notebook-summary:${identity}`),
    workspaceId,
    roomId: sources[0]!.roomId,
    taskNodeId: sources[0]!.taskNodeId,
    concern: sources.every((entry) => entry.concern === sources[0]!.concern)
      ? sources[0]!.concern
      : "cross-concern summary",
    authorSeatId: input.authorSeatId,
    kind: "lesson",
    content: input.content,
    evidenceRefs,
    confidence: Math.min(...sources.map((entry) => entry.confidence)),
    supersedesEntryId: null,
    protectionClass: sources[0]!.protectionClass,
    redactedAt: null,
    createdAt: input.createdAt,
  };
  return {
    summaryEntry,
    receipt: {
      id: SupervisorNotebookCompactionReceiptId.makeUnsafe(`notebook-compaction:${identity}`),
      workspaceId,
      summaryEntryId: summaryEntry.id,
      sourceEntryIds,
      evidenceRefs,
      createdBySeatId: input.authorSeatId,
      createdAt: input.createdAt,
    },
  };
}
