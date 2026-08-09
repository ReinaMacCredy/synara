import { createHash, randomUUID } from "node:crypto";

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
  const protectionClasses = new Set(input.allowedProtectionClasses);
  const cursorBoundary = input.cursor
    ? `${input.cursor.lastCreatedAt ?? ""}\u0000${input.cursor.lastEntryId ?? ""}`
    : null;
  const candidates = input.entries.filter((entry) => {
    if (entry.workspaceId !== input.workspaceId || entry.redactedAt !== null) return false;
    if (!protectionClasses.has(entry.protectionClass)) return false;
    if (input.roomId !== undefined && entry.roomId !== input.roomId) return false;
    if (input.taskNodeId !== undefined && entry.taskNodeId !== input.taskNodeId) return false;
    if (input.concern !== undefined && entry.concern !== input.concern) return false;
    if (cursorBoundary === null) return true;
    return `${entry.createdAt}\u0000${entry.id}` > cursorBoundary;
  });
  const candidateIds = new Set(candidates.map((entry) => entry.id));
  const supersededIds = new Set(
    candidates.flatMap((entry) => (entry.supersedesEntryId === null ? [] : [entry.supersedesEntryId])),
  );
  const compactedIds = new Set(
    input.compactionReceipts.flatMap((receipt) =>
      receipt.workspaceId === input.workspaceId && candidateIds.has(receipt.summaryEntryId)
        ? receipt.sourceEntryIds
        : [],
    ),
  );
  const entries = candidates
    .filter((entry) => !supersededIds.has(entry.id) && !compactedIds.has(entry.id))
    .toSorted(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )
    .slice(0, Math.max(1, Math.min(input.limit, 512)));
  const newest = entries[0] ?? null;
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
    compactionReceipts: input.compactionReceipts.filter(
      (receipt) => receipt.workspaceId === input.workspaceId,
    ),
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
  const sourceEntryIds = [...new Set(input.sourceEntryIds)];
  if (sourceEntryIds.length === 0) throw new Error("Notebook compaction requires source entries.");
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
  if (sources.some((entry) => entry.protectionClass !== sources[0]!.protectionClass)) {
    throw new Error("Notebook compaction cannot cross protection classes.");
  }
  const summaryEntry: SupervisorNotebookEntry = {
    id: SupervisorNotebookEntryId.makeUnsafe(`notebook-summary:${randomUUID()}`),
    workspaceId,
    roomId: sources[0]!.roomId,
    taskNodeId: null,
    concern: sources.every((entry) => entry.concern === sources[0]!.concern)
      ? sources[0]!.concern
      : "cross-concern summary",
    authorSeatId: input.authorSeatId,
    kind: "lesson",
    content: input.content,
    evidenceRefs: [...new Set(sources.flatMap((entry) => entry.evidenceRefs))],
    confidence: Math.min(...sources.map((entry) => entry.confidence)),
    supersedesEntryId: null,
    protectionClass: sources[0]!.protectionClass,
    redactedAt: null,
    createdAt: input.createdAt,
  };
  return {
    summaryEntry,
    receipt: {
      id: SupervisorNotebookCompactionReceiptId.makeUnsafe(`notebook-compaction:${randomUUID()}`),
      workspaceId,
      summaryEntryId: summaryEntry.id,
      sourceEntryIds,
      evidenceRefs: summaryEntry.evidenceRefs,
      createdBySeatId: input.authorSeatId,
      createdAt: input.createdAt,
    },
  };
}
