// FILE: MessagesTimeline.logic.ts
// Purpose: Owns the pure row-derivation helpers used by the transcript hot path.
// Layer: Web chat presentation helpers
// Exports: row derivation, structural sharing, copy/timer helpers

import { type MessageId, type TurnId } from "@veylen/contracts";
import {
  hasTurnWorkspaceMutationEvidence,
  type TimelineEntry,
  type WorkLogEntry,
  formatElapsed,
} from "../../session-logic";
import { normalizeCompactToolLabel as normalizeCompactToolLabelValue } from "../../lib/toolCallLabel";
import {
  isSummarizableToolCallEntry,
  summarizeToolCallGroup,
  type ToolCallGroupSummary,
} from "./toolCallGroup.logic";
import { formatAgentActivityEntryPreview, isReasoningUpdateWorkEntry } from "./agentActivity.logic";
import {
  type ChatMessage,
  type ProposedPlan,
  type TurnDiffSummary,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStep,
} from "../../types";

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 6;

export function canSubmitUserMessageEdit(input: {
  draft: string;
  allowEmpty: boolean;
  disabled: boolean;
}): boolean {
  return (input.allowEmpty || input.draft.trim().length > 0) && !input.disabled;
}

// Ordered item folded into a settled turn's single "Worked for Xs" disclosure.
// A turn can interleave tool work and intermediate assistant narration
// (preambles), so the collapsed panel keeps both in chronological order.
export type CollapsedTurnItem =
  | { kind: "work"; id: string; entry: WorkLogEntry }
  | { kind: "narration"; id: string; message: ChatMessage };

// A settled turn's collapsed items re-chunked for rendering: consecutive
// summarizable tool rows fold into one "Ran N commands..." disclosure while
// narration and rich rows pass through individually.
export type CollapsedTurnChunk =
  | { kind: "item"; item: CollapsedTurnItem }
  | { kind: "tool-group"; id: string; entries: WorkLogEntry[] };

export type WorkEntryChunk =
  | { kind: "item"; id: string; entry: WorkLogEntry }
  | { kind: "tool-group"; id: string; entries: WorkLogEntry[] };

type WorkspaceMutationEvidenceEntry = Pick<
  WorkLogEntry,
  "changedFiles" | "itemType" | "requestKind" | "turnId"
>;

export function chunkCollapsedTurnItems(
  items: ReadonlyArray<CollapsedTurnItem>,
): CollapsedTurnChunk[] {
  const chunks: CollapsedTurnChunk[] = [];
  let pendingRun: Extract<CollapsedTurnItem, { kind: "work" }>[] = [];

  const flushPendingRun = () => {
    if (pendingRun.length === 0) return;
    if (summarizeToolCallGroup(pendingRun.map((item) => item.entry))) {
      chunks.push({
        kind: "tool-group",
        id: pendingRun[0]!.id,
        entries: pendingRun.map((item) => item.entry),
      });
    } else {
      for (const item of pendingRun) {
        chunks.push({ kind: "item", item });
      }
    }
    pendingRun = [];
  };

  for (const item of items) {
    if (
      item.kind === "work" &&
      (isSummarizableToolCallEntry(item.entry) || isReasoningUpdateWorkEntry(item.entry))
    ) {
      pendingRun.push(item);
      continue;
    }
    flushPendingRun();
    chunks.push({ kind: "item", item });
  }
  flushPendingRun();
  return chunks;
}

export function chunkWorkEntries(entries: ReadonlyArray<WorkLogEntry>): WorkEntryChunk[] {
  return chunkCollapsedTurnItems(
    entries.map((entry) => ({ kind: "work" as const, id: entry.id, entry })),
  ).map((chunk) => {
    if (chunk.kind === "tool-group") return chunk;
    if (chunk.item.kind !== "work") {
      throw new Error("Work-entry chunking produced an unexpected narration item.");
    }
    return { kind: "item", id: chunk.item.id, entry: chunk.item.entry };
  });
}

// One renderable block of a work group: `summary` is non-null when the block
// renders collapsed behind a "Ran N commands..." disclosure.
export interface WorkEntryRenderPlanChunk {
  id: string;
  entries: WorkLogEntry[];
  summary: ToolCallGroupSummary | null;
  headline: string | null;
  live: boolean;
}

// Plans a work group's entries block by block. Reasoning updates ride with the
// adjacent tool run so they can drive its headline; errors and rich cards stay
// as boundaries. A run remains live while it has running work or owns the
// transcript tail (`tailIsLive`).
export function planWorkEntryRenderChunks(
  entries: ReadonlyArray<WorkLogEntry>,
  options: { tailIsLive: boolean },
): WorkEntryRenderPlanChunk[] {
  const chunks = chunkWorkEntries(entries);
  return chunks.map((chunk, index) => {
    if (chunk.kind === "item") {
      return {
        id: chunk.id,
        entries: [chunk.entry],
        summary: null,
        headline: null,
        live: false,
      };
    }
    const summary = summarizeToolCallGroup(chunk.entries);
    const tailEntry = chunk.entries.at(-1);
    const headline =
      tailEntry && isReasoningUpdateWorkEntry(tailEntry)
        ? formatAgentActivityEntryPreview(tailEntry)
        : null;
    const isLiveTail = options.tailIsLive && index === chunks.length - 1;
    const live = summary !== null && (summary.hasRunningEntry || isLiveTail);
    return { id: chunk.id, entries: chunk.entries, summary, headline, live };
  });
}

export interface CappedWorkEntryRenderPlan {
  chunks: WorkEntryRenderPlanChunk[];
  hasOverflow: boolean;
  hiddenEntryCount: number;
}

// Keeps collapsed summaries intact while bounding only the entries that still
// render openly. Callers can exclude boundary/status rows from the budget when
// those rows are rendered separately from tool calls.
export function capOpenWorkEntryRenderChunks(
  chunks: ReadonlyArray<WorkEntryRenderPlanChunk>,
  options: {
    expanded: boolean;
    maxVisibleEntries: number;
    keep: "first" | "last";
    shouldCapEntry?: (entry: WorkLogEntry) => boolean;
  },
): CappedWorkEntryRenderPlan {
  const shouldCapEntry = options.shouldCapEntry ?? (() => true);
  const openEntries = chunks.flatMap((chunk) =>
    chunk.summary === null ? chunk.entries.filter(shouldCapEntry) : [],
  );
  const maxVisibleEntries = Math.max(0, options.maxVisibleEntries);
  const hiddenEntryCount = Math.max(0, openEntries.length - maxVisibleEntries);
  const hasOverflow = hiddenEntryCount > 0;

  if (!hasOverflow || options.expanded) {
    return { chunks: [...chunks], hasOverflow, hiddenEntryCount: 0 };
  }

  const visibleEntries =
    maxVisibleEntries === 0
      ? []
      : options.keep === "last"
        ? openEntries.slice(-maxVisibleEntries)
        : openEntries.slice(0, maxVisibleEntries);
  const visibleEntrySet = new Set(visibleEntries);

  return {
    chunks: chunks.map((chunk) => {
      if (chunk.summary !== null && !chunk.live) return chunk;
      return {
        ...chunk,
        entries: chunk.entries.filter(
          (entry) => !shouldCapEntry(entry) || visibleEntrySet.has(entry),
        ),
      };
    }),
    hasOverflow,
    hiddenEntryCount,
  };
}

// The newest work group in the transcript — the one still allowed to render its
// rows inline while the turn is live. Everything older collapses to a summary.
export function findLastLiveWorkGroupId(rows: ReadonlyArray<MessagesTimelineRow>): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "work") {
      return row.id;
    }
    if (row.kind === "message") {
      const groupId = row.inlineWorkGroupId ?? row.leadingWorkGroupId;
      if (groupId) {
        return groupId;
      }
      // A user message closes the previous turn: nothing before it is live.
      if (row.message.role === "user") {
        return null;
      }
    }
  }
  return null;
}

export interface TimelineDurationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "thread";
  createdAt: string;
  turnId?: string | null;
  completedAt?: string | undefined;
}

interface TimelineDiffMessage {
  id: MessageId;
  role: "user" | "assistant" | "system" | "thread";
  turnId: TurnId | null;
}

export type MessagesTimelineRow =
  | {
      kind: "work";
      id: string;
      createdAt: string;
      groupedEntries: WorkLogEntry[];
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: ChatMessage;
      leadingWorkEntries?: WorkLogEntry[];
      leadingWorkGroupId?: string;
      inlineWorkEntries?: WorkLogEntry[];
      inlineWorkGroupId?: string;
      collapsedTurnItems?: CollapsedTurnItem[];
      collapsedWorkElapsed?: string | null;
      durationStart: string;
      showAssistantCopyButton: boolean;
      assistantCopyStreaming: boolean;
      assistantTurnDiffSummary?: TurnDiffSummary | undefined;
      // True while this row's turn is still running. The end-of-turn changes
      // card (Undo / Review) is held back until the turn settles so it cannot
      // pre-empt the composer's live changes strip mid-turn.
      assistantTurnInProgress?: boolean | undefined;
      revertTurnCount?: number | undefined;
    }
  | {
      kind: "proposed-plan";
      id: string;
      createdAt: string;
      proposedPlan: ProposedPlan;
    }
  | {
      // One stable row owns the turn's live and settled activity states. Its
      // id is derived from the user-message boundary so provider start-time
      // hydration and terminal folding update in place instead of inserting a
      // second header into the transcript.
      kind: "turn-activity";
      id: string;
      createdAt: string | null;
      state: "working" | "settled";
      showReasoningStatus: boolean;
      reasoningEntries?: WorkLogEntry[];
      collapsedTurnItems?: CollapsedTurnItem[];
      collapsedWorkElapsed?: string | null;
    }
  | {
      kind: "reasoning-status";
      id: string;
      scopeKey: string;
      reasoningEntries: WorkLogEntry[];
    }
  | {
      // Transient "Preparing worktree..." step card shown during the New
      // worktree first-send setup. `open` drives the shared disclosure close
      // animation while the presentation hook keeps the row mounted.
      kind: "worktree-setup";
      id: string;
      steps: ReadonlyArray<WorktreeSetupStep>;
      open: boolean;
    };

export interface StableMessagesTimelineRowsState {
  byId: Map<string, MessagesTimelineRow>;
  result: MessagesTimelineRow[];
}

export function computeMessageDurationStart(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Map<string, string> {
  const result = new Map<string, string>();
  let lastBoundary: string | null = null;

  for (const message of messages) {
    if (message.role === "user") {
      lastBoundary = message.createdAt;
    }
    result.set(message.id, lastBoundary ?? message.createdAt);
    if (message.role === "assistant" && message.completedAt) {
      lastBoundary = message.completedAt;
    }
  }

  return result;
}

export function normalizeCompactToolLabel(value: string): string {
  return normalizeCompactToolLabelValue(value);
}

export function resolveAssistantMessageCopyState({
  text,
  showCopyButton,
  streaming,
}: {
  text: string | null;
  showCopyButton: boolean;
  streaming: boolean;
}) {
  const normalizedText = text?.trim() ? text : null;
  return {
    text: normalizedText,
    visible: showCopyButton && normalizedText !== null && !streaming,
  };
}

type AssistantMessageDisplayInput = {
  readonly message: Pick<ChatMessage, "text" | "streaming">;
  readonly leadingWorkEntries?: ReadonlyArray<WorkLogEntry>;
  readonly inlineWorkEntries?: ReadonlyArray<WorkLogEntry>;
  readonly collapsedTurnItems?: ReadonlyArray<CollapsedTurnItem>;
};

function isVisibleGeneratedImageEntry(entry: WorkLogEntry): boolean {
  return (
    entry.itemType === "image_generation" &&
    entry.activityKind === "tool.completed" &&
    entry.tone !== "error"
  );
}

/**
 * Resolves the markdown body for an assistant row. A completed image-generation
 * work item is already visible non-text output, so an adjacent empty provider
 * message must not add the misleading "(empty response)" placeholder. Truly
 * empty settled turns retain the placeholder, and live empty text stays blank.
 */
export function resolveAssistantMessageDisplayText(
  input: AssistantMessageDisplayInput,
): string | null {
  if (input.message.text) {
    return input.message.text;
  }
  if (input.message.streaming) {
    return "";
  }

  const hasVisibleGeneratedImage = [
    ...(input.leadingWorkEntries ?? []),
    ...(input.inlineWorkEntries ?? []),
    ...(input.collapsedTurnItems ?? []).flatMap((item) =>
      item.kind === "work" ? [item.entry] : [],
    ),
  ].some(isVisibleGeneratedImageEntry);

  return hasVisibleGeneratedImage ? null : "(empty response)";
}

// Builds the "Files changed" lookup keyed by the last assistant row in the
// user-visible response segment. Provider mini-turns can emit diffs before the
// final answer, so the card follows the segment tail instead of the raw turn.
// When work evidence is available, a raw workspace snapshot alone cannot claim
// ownership: the turn must also contain a mutation-capable tool entry.
export function buildTurnDiffSummaryByAssistantMessageId(input: {
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  messages: ReadonlyArray<TimelineDiffMessage>;
  workLogEntries?: ReadonlyArray<WorkspaceMutationEvidenceEntry>;
}): Map<MessageId, TurnDiffSummary> {
  const byMessageId = new Map<MessageId, TurnDiffSummary>();
  if (input.turnDiffSummaries.length === 0) return byMessageId;

  const summaryByTurnId = new Map<string, TurnDiffSummary>();
  for (const summary of input.turnDiffSummaries) {
    summaryByTurnId.set(summary.turnId, summary);
  }

  const messageIndexByTurnId = new Map<string, number>();
  for (let index = 0; index < input.messages.length; index += 1) {
    const message = input.messages[index]!;
    if (message.role !== "assistant" || !message.turnId) continue;
    messageIndexByTurnId.set(message.turnId, index);
  }

  for (const [turnId, summary] of summaryByTurnId) {
    if (
      input.workLogEntries !== undefined &&
      !hasTurnWorkspaceMutationEvidence(input.workLogEntries, summary.turnId)
    ) {
      continue;
    }
    const anchorIndex = messageIndexByTurnId.get(turnId);
    if (anchorIndex === undefined) continue;
    let terminalAssistantMessageId: MessageId | null = null;
    for (let index = anchorIndex; index < input.messages.length; index += 1) {
      const message = input.messages[index]!;
      if (index > anchorIndex && message.role === "user") break;
      if (message.role === "assistant") {
        terminalAssistantMessageId = message.id;
      }
    }
    if (!terminalAssistantMessageId) continue;

    byMessageId.set(
      terminalAssistantMessageId,
      mergeTurnDiffSummaries(byMessageId.get(terminalAssistantMessageId), summary),
    );
  }
  return byMessageId;
}

// Keeps multi-turn provider responses from losing earlier "Files changed" rows
// when several turn-diff summaries anchor to the same final assistant message.
function mergeTurnDiffSummaries(
  existing: TurnDiffSummary | undefined,
  next: TurnDiffSummary,
): TurnDiffSummary {
  const checkpointTurnCountsFor = (summary: TurnDiffSummary): number[] => {
    if (
      summary.files.length === 0 ||
      summary.status === "missing" ||
      summary.status === "error" ||
      summary.checkpointRef === undefined ||
      summary.checkpointRef.startsWith("provider-diff:")
    ) {
      return [];
    }
    return (
      summary.checkpointTurnCounts ??
      (summary.checkpointTurnCount === undefined ? [] : [summary.checkpointTurnCount])
    );
  };
  if (!existing) {
    const checkpointTurnCounts = checkpointTurnCountsFor(next);
    return { ...next, checkpointTurnCounts };
  }

  const filesByPath = new Map(existing.files.map((file) => [file.path, file]));
  for (const file of next.files) {
    filesByPath.set(file.path, file);
  }
  const checkpointTurnCounts = new Set([
    ...checkpointTurnCountsFor(existing),
    ...checkpointTurnCountsFor(next),
  ]);
  const undoMetadata =
    checkpointTurnCountsFor(next).length > 0
      ? next
      : checkpointTurnCountsFor(existing).length > 0
        ? existing
        : next;
  const allDisplayedFilesUndoable = [existing, next].every(
    (summary) => summary.files.length === 0 || checkpointTurnCountsFor(summary).length > 0,
  );

  return {
    ...next,
    files: [...filesByPath.values()],
    checkpointRef: undoMetadata.checkpointRef,
    status: undoMetadata.status,
    checkpointTurnCount: undoMetadata.checkpointTurnCount,
    checkpointTurnCounts: allDisplayedFilesUndoable
      ? [...checkpointTurnCounts].toSorted((left, right) => left - right)
      : [],
  };
}

export function deriveTerminalAssistantMessageIds(
  messages: ReadonlyArray<TimelineDurationMessage>,
): Set<string> {
  const terminalAssistantMessageIds = new Set<string>();
  let latestAssistantMessageId: string | null = null;

  for (const message of messages) {
    if (message.role !== "assistant") {
      if (latestAssistantMessageId) {
        terminalAssistantMessageIds.add(latestAssistantMessageId);
        latestAssistantMessageId = null;
      }
      continue;
    }
    latestAssistantMessageId = message.id;
  }

  if (latestAssistantMessageId) {
    terminalAssistantMessageIds.add(latestAssistantMessageId);
  }

  return terminalAssistantMessageIds;
}

// Derives transcript rows from timeline entries while keeping live narration and
// tool rows in visual chronology. Work already waiting when assistant text
// arrives renders above that text; trailing work renders below it.
export function deriveMessagesTimelineRows(input: {
  timelineEntries: ReadonlyArray<TimelineEntry>;
  isWorking: boolean;
  worktreeSetup: WorktreeSetupSnapshot | null;
  worktreeSetupOpen: boolean;
  activeTurnInProgress?: boolean;
  activeTurnId?: TurnId | null | undefined;
  activeTurnStartedAt: string | null;
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, TurnDiffSummary>;
  revertTurnCountByUserMessageId: ReadonlyMap<MessageId, number>;
}): MessagesTimelineRow[] {
  const nextRows: MessagesTimelineRow[] = [];
  let latestUserMessageEntryIndex = -1;
  for (let index = input.timelineEntries.length - 1; index >= 0; index -= 1) {
    const entry = input.timelineEntries[index];
    if (entry?.kind === "message" && entry.message.role === "user") {
      latestUserMessageEntryIndex = index;
      break;
    }
  }
  const belongsToActiveTurn = (entry: WorkLogEntry): boolean => {
    if (input.activeTurnId != null && entry.turnId != null && entry.turnId !== input.activeTurnId) {
      return false;
    }
    return true;
  };
  const hasLiveStartedWorkAfterUser = input.timelineEntries.some((entry, index) => {
    if (index <= latestUserMessageEntryIndex) return false;
    if (entry.kind !== "work") return false;
    if (!belongsToActiveTurn(entry.entry)) return false;
    // ChatGPT lHn: any item that is not user/worktree/transcript counts.
    return isLiveStartedWorkEntry(entry.entry);
  });
  const activeReasoningEntries: WorkLogEntry[] = [];
  let earliestActiveReasoningIndex = -1;
  if (input.isWorking && !hasLiveStartedWorkAfterUser) {
    for (
      let index = input.timelineEntries.length - 1;
      index > latestUserMessageEntryIndex;
      index -= 1
    ) {
      const entry = input.timelineEntries[index];
      if (!entry) continue;
      if (entry.kind === "message") {
        if (entry.message.role === "assistant") continue;
        break;
      }
      if (entry.kind !== "work") continue;
      if (!belongsToActiveTurn(entry.entry)) continue;
      if (isReasoningUpdateWorkEntry(entry.entry)) {
        activeReasoningEntries.unshift(entry.entry);
        earliestActiveReasoningIndex = index;
        continue;
      }
      break;
    }
  }
  const entryBeforeActiveReasoning =
    earliestActiveReasoningIndex > latestUserMessageEntryIndex + 1
      ? input.timelineEntries[earliestActiveReasoningIndex - 1]
      : undefined;
  const activeReasoningBelongsToToolGroup =
    entryBeforeActiveReasoning?.kind === "work" &&
    isSummarizableToolCallEntry(entryBeforeActiveReasoning.entry);
  const detachedActiveReasoningEntries = activeReasoningBelongsToToolGroup
    ? []
    : activeReasoningEntries;
  const activeReasoningEntryIds = new Set(detachedActiveReasoningEntries.map((entry) => entry.id));
  const hasActiveAgentWorkAfterUser = input.timelineEntries.some((entry, index) => {
    if (index <= latestUserMessageEntryIndex) return false;
    if (entry.kind !== "work") return false;
    if (!belongsToActiveTurn(entry.entry)) return false;
    return isAgentWorkActivityEntry(entry.entry);
  });
  // Pure-text answers (e.g. "hi") stream body while isWorking is still true.
  // ChatGPT `Nzn`/`ja`: hide Thinking once final-answer content exists — not
  // only after the turn settles. Tool preambles still get Working via
  // hasStartedWork before/alongside body.
  const hasAssistantBodyAfterUser = input.timelineEntries.some((entry, index) => {
    if (index <= latestUserMessageEntryIndex) return false;
    if (entry.kind !== "message" || entry.message.role !== "assistant") return false;
    if (
      input.activeTurnId != null &&
      entry.message.turnId != null &&
      entry.message.turnId !== input.activeTurnId
    ) {
      return false;
    }
    return (entry.message.text?.trim().length ?? 0) > 0;
  });
  const timelineEntries =
    activeReasoningEntryIds.size === 0
      ? input.timelineEntries
      : input.timelineEntries.filter(
          (entry) => entry.kind !== "work" || !activeReasoningEntryIds.has(entry.entry.id),
        );
  const timelineMessages = timelineEntries.flatMap((entry) =>
    entry.kind === "message" ? [entry.message] : [],
  );
  const durationStartByMessageId = computeMessageDurationStart(timelineMessages);
  const terminalAssistantMessageIds = deriveTerminalAssistantMessageIds(timelineMessages);
  let pendingWorkGroup: Extract<MessagesTimelineRow, { kind: "work" }> | null = null;

  const groupedEntriesEqual = (
    left: ReadonlyArray<WorkLogEntry>,
    right: ReadonlyArray<WorkLogEntry>,
  ) => left.length === right.length && left.every((entry, index) => entry === right[index]);

  const appendWorkEntriesToPreviousAssistant = (
    groupedEntries: WorkLogEntry[],
    groupId: string,
  ): boolean => {
    const previousRow = nextRows.at(-1);
    if (
      !previousRow ||
      previousRow.kind !== "message" ||
      previousRow.message.role !== "assistant"
    ) {
      return false;
    }

    const nextInlineWorkEntries = previousRow.inlineWorkEntries
      ? [...previousRow.inlineWorkEntries, ...groupedEntries]
      : groupedEntries;

    if (groupedEntriesEqual(previousRow.inlineWorkEntries ?? [], nextInlineWorkEntries)) {
      return true;
    }

    previousRow.inlineWorkEntries = nextInlineWorkEntries;
    previousRow.inlineWorkGroupId ??= groupId;
    return true;
  };

  const flushPendingWorkGroup = (options?: { attachToPreviousAssistant?: boolean }) => {
    if (!pendingWorkGroup) return;
    const shouldAttachToPreviousAssistant = options?.attachToPreviousAssistant ?? true;
    if (
      !shouldAttachToPreviousAssistant ||
      !appendWorkEntriesToPreviousAssistant(pendingWorkGroup.groupedEntries, pendingWorkGroup.id)
    ) {
      nextRows.push(pendingWorkGroup);
    }
    pendingWorkGroup = null;
  };

  for (let index = 0; index < timelineEntries.length; index += 1) {
    const timelineEntry = timelineEntries[index];
    if (!timelineEntry) {
      continue;
    }

    if (timelineEntry.kind === "work") {
      const groupedEntries = [timelineEntry.entry];
      let cursor = index + 1;
      while (cursor < timelineEntries.length) {
        const nextEntry = timelineEntries[cursor];
        if (!nextEntry || nextEntry.kind !== "work") break;
        groupedEntries.push(nextEntry.entry);
        cursor += 1;
      }
      flushPendingWorkGroup();
      pendingWorkGroup = {
        kind: "work",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        groupedEntries,
      };
      index = cursor - 1;
      continue;
    }

    if (timelineEntry.kind === "proposed-plan") {
      // A plan card is a visible mid-turn artifact. Keep adjacent work as its
      // own row so final turn collapse can preserve the true chronology.
      flushPendingWorkGroup({ attachToPreviousAssistant: false });
      nextRows.push({
        kind: "proposed-plan",
        id: timelineEntry.id,
        createdAt: timelineEntry.createdAt,
        proposedPlan: timelineEntry.proposedPlan,
      });
      continue;
    }

    const message = timelineEntry.message;
    let leadingWorkEntries: WorkLogEntry[] | undefined;
    let leadingWorkGroupId: string | undefined;
    if (message.role === "assistant") {
      if (
        pendingWorkGroup &&
        !appendWorkEntriesToPreviousAssistant(pendingWorkGroup.groupedEntries, pendingWorkGroup.id)
      ) {
        leadingWorkEntries = pendingWorkGroup.groupedEntries;
        leadingWorkGroupId = pendingWorkGroup.id;
      }
      pendingWorkGroup = null;
    } else {
      flushPendingWorkGroup();
    }

    const assistantTurnStillInProgress =
      message.role === "assistant" &&
      input.activeTurnInProgress === true &&
      input.activeTurnId != null &&
      message.turnId === input.activeTurnId &&
      index > latestUserMessageEntryIndex;

    nextRows.push({
      kind: "message",
      id: timelineEntry.id,
      createdAt: timelineEntry.createdAt,
      message,
      ...(leadingWorkEntries ? { leadingWorkEntries } : {}),
      ...(leadingWorkGroupId ? { leadingWorkGroupId } : {}),
      durationStart: durationStartByMessageId.get(message.id) ?? message.createdAt,
      showAssistantCopyButton:
        message.role === "assistant" && terminalAssistantMessageIds.has(message.id),
      assistantCopyStreaming: message.streaming || assistantTurnStillInProgress,
      assistantTurnInProgress: assistantTurnStillInProgress,
      assistantTurnDiffSummary:
        message.role === "assistant"
          ? input.turnDiffSummaryByAssistantMessageId.get(message.id)
          : undefined,
      revertTurnCount:
        message.role === "user" ? input.revertTurnCountByUserMessageId.get(message.id) : undefined,
    });
  }

  // Keep any trailing work summary visually attached to the last answer so a
  // completed chat does not end with a detached tool-log footer.
  flushPendingWorkGroup();

  if (input.worktreeSetup) {
    nextRows.push({
      kind: "worktree-setup",
      id: "worktree-setup-row",
      steps: input.worktreeSetup.steps,
      open: input.worktreeSetupOpen,
    });
  }

  collapseSettledTurns(nextRows, {
    terminalAssistantMessageIds,
    activeTurnInProgress: input.activeTurnInProgress ?? false,
    activeTurnId: input.activeTurnId ?? null,
  });

  // Live lifecycle (ChatGPT parity — `ja` / `JBn` / `wo` + Fr/uO):
  // - Thinking while live and agent work has NOT started yet (preamble text OK)
  // - Working for… only once hasStartedWork (tools/info) — exclusive with Thinking
  // - Clock starts at first agent-activity item (not user send / thinking wait)
  // - Pure text turns never grow a Working header (no agent work → no Worked for)
  if (input.isWorking && !(input.worktreeSetup && input.worktreeSetupOpen)) {
    const insertIndex = findLiveTurnActivityInsertIndex(nextRows);
    const boundaryRow = nextRows[insertIndex - 1];
    const boundaryMessageId =
      boundaryRow?.kind === "message" && boundaryRow.message.role === "user"
        ? boundaryRow.message.id
        : null;
    const activityId = turnActivityRowId(boundaryMessageId, input.activeTurnId ?? null);
    const settledActivityAlreadyOwnsTurn = nextRows.some(
      (row) => row.kind === "turn-activity" && row.id === activityId && row.state === "settled",
    );
    // Also treat work already attached to live messages as started work so a
    // turnId / timeline-index race cannot paint process without a Working header.
    const hasStartedWorkOnLiveRows = nextRows.some((row, index) => {
      if (index < insertIndex) return false;
      if (row.kind === "work") {
        return row.groupedEntries.some(isLiveStartedWorkEntry);
      }
      if (row.kind !== "message" || row.message.role !== "assistant") return false;
      const attached = [...(row.leadingWorkEntries ?? []), ...(row.inlineWorkEntries ?? [])];
      return attached.some(isLiveStartedWorkEntry);
    });
    // ChatGPT `JBn`/`lHn`: Working as soon as hasStartedWork (reasoning OR tools).
    const showWorkingPhase =
      !settledActivityAlreadyOwnsTurn &&
      (hasLiveStartedWorkAfterUser || hasActiveAgentWorkAfterUser || hasStartedWorkOnLiveRows);
    // Live: keep Working (never early Worked-for). ChatGPT only collapses under
    // Worked for after the turn finishes (`wo` needs final assistant + settled
    // turn). Premature collapse made preambles look like the final answer and
    // hid live tools mid-run.
    if (showWorkingPhase) {
      // ChatGPT `worked-for.startedAtMs` is the agent-activity origin (first
      // tool/info), not the user-send time. Using turn start made "Working for
      // 16s" appear the moment tools landed after a long Thinking phase.
      const agentWorkStartedAt = findEarliestActiveAgentWorkStartedAt(
        input.timelineEntries,
        latestUserMessageEntryIndex,
        input.activeTurnId,
        nextRows,
        insertIndex,
      );
      nextRows.splice(insertIndex, 0, {
        kind: "turn-activity",
        id: activityId,
        createdAt: agentWorkStartedAt ?? input.activeTurnStartedAt,
        state: "working",
        showReasoningStatus: false,
      });
    }
    // Thinking stays until Working starts (ChatGPT `ja`: hide on final_answer or
    // agent-in-progress). Pure-text body also clears Thinking while isWorking
    // is still true so "hi" does not flash Thinking above the answer.
    // Insert at the same index as Working so order is:
    //   user → Thinking|Working → text/tools  (never text → Thinking at tail)
    const showThinkingPhase =
      !settledActivityAlreadyOwnsTurn && !showWorkingPhase && !hasAssistantBodyAfterUser;
    if (showThinkingPhase) {
      const phaseBoundaryId = findActiveReasoningPhaseBoundaryId(
        timelineEntries,
        latestUserMessageEntryIndex,
        input.activeTurnId,
      );
      const scopeKey = `${activityId}:reasoning:${phaseBoundaryId}`;
      nextRows.splice(insertIndex, 0, {
        kind: "reasoning-status",
        id: scopeKey,
        scopeKey,
        reasoningEntries: detachedActiveReasoningEntries,
      });
    }
  }

  return nextRows;
}

// ChatGPT Working clock: first hasStartedWork timestamp after the user boundary
// (reasoning or tools — same as lHn origin, not user-send / Thinking wait).
function findEarliestActiveAgentWorkStartedAt(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  latestUserMessageEntryIndex: number,
  activeTurnId: TurnId | null | undefined,
  rows: ReadonlyArray<MessagesTimelineRow>,
  liveInsertIndex: number,
): string | null {
  let earliest: string | null = null;
  let earliestMs = Number.POSITIVE_INFINITY;

  const consider = (iso: string | null | undefined) => {
    if (!iso) return;
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms) || ms >= earliestMs) return;
    earliestMs = ms;
    earliest = iso;
  };

  for (let index = latestUserMessageEntryIndex + 1; index < timelineEntries.length; index += 1) {
    const entry = timelineEntries[index];
    if (!entry || entry.kind !== "work") continue;
    if (activeTurnId != null && entry.entry.turnId != null && entry.entry.turnId !== activeTurnId) {
      continue;
    }
    if (!isLiveStartedWorkEntry(entry.entry)) continue;
    consider(entry.entry.createdAt ?? entry.createdAt);
  }

  if (earliest != null) return earliest;

  for (let index = liveInsertIndex; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.kind === "work") {
      for (const workEntry of row.groupedEntries) {
        if (isLiveStartedWorkEntry(workEntry)) consider(workEntry.createdAt);
      }
      continue;
    }
    if (row.kind !== "message" || row.message.role !== "assistant") continue;
    for (const workEntry of [...(row.leadingWorkEntries ?? []), ...(row.inlineWorkEntries ?? [])]) {
      if (isLiveStartedWorkEntry(workEntry)) consider(workEntry.createdAt);
    }
  }

  return earliest;
}

// The live turn starts at the most recent user message, so its header slots in
// right after it. Absent any user message (degenerate transcripts) the header
// leads the transcript so the "Working for" copy is never lost.
function findLiveTurnActivityInsertIndex(rows: ReadonlyArray<MessagesTimelineRow>): number {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind === "message" && row.message.role === "user") {
      return index + 1;
    }
  }
  return 0;
}

function findActiveReasoningPhaseBoundaryId(
  timelineEntries: ReadonlyArray<TimelineEntry>,
  latestUserMessageEntryIndex: number,
  activeTurnId: TurnId | null | undefined,
): string {
  for (let index = timelineEntries.length - 1; index > latestUserMessageEntryIndex; index -= 1) {
    const entry = timelineEntries[index];
    if (!entry) continue;
    if (entry.kind === "message") {
      if (entry.message.role === "assistant" && entry.message.turnId === activeTurnId) {
        return entry.id;
      }
      continue;
    }
    if (entry.kind === "work" && entry.entry.turnId === activeTurnId) {
      return entry.id;
    }
  }
  return timelineEntries[latestUserMessageEntryIndex]?.id ?? "initial";
}

function turnActivityRowId(boundaryMessageId: MessageId | null, turnId: TurnId | null): string {
  return `turn-activity:${boundaryMessageId ?? turnId ?? "pending"}`;
}

// Sticky Worked-for after a true idle settle. Survives activeTurnInProgress flaps
// without collapsing mid-run on intermediate message.completedAt.
const stickySettledActivityIds = new Set<string>();

/** Test isolation only. */
export function resetMessagesTimelineStickySettleForTests(): void {
  stickySettledActivityIds.clear();
}

// Returns the terminal assistant only when it is still the transcript tail.
// A newer user message means the next turn has begun but has not produced text yet.
function findTailTerminalAssistantMessageId(
  rows: ReadonlyArray<MessagesTimelineRow>,
  terminalAssistantMessageIds: ReadonlySet<string>,
): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.kind !== "message") {
      continue;
    }
    return row.message.role === "assistant" && terminalAssistantMessageIds.has(row.message.id)
      ? row.message.id
      : null;
  }
  return null;
}

// Post-pass: collapse each *settled* turn into a single "Worked for Xs"
// disclosure on the turn's terminal assistant message. Unlike a per-message
// collapse, this folds every non-terminal assistant narration (preambles) AND
// the turn's tool work into one ordered group, so the transcript shows a single
// toggle + the final answer per turn (Remodex-style). The live turn stays
// expanded/inline so streaming output is never hidden behind a toggle.
function collapseSettledTurns(
  rows: MessagesTimelineRow[],
  options: {
    terminalAssistantMessageIds: ReadonlySet<string>;
    activeTurnInProgress: boolean;
    activeTurnId: TurnId | null;
  },
): void {
  const { terminalAssistantMessageIds, activeTurnInProgress, activeTurnId } = options;
  const lastTerminalAssistantMessageId = activeTurnInProgress
    ? findTailTerminalAssistantMessageId(rows, terminalAssistantMessageIds)
    : null;

  const collectWorkItems = (entries: ReadonlyArray<WorkLogEntry>, into: CollapsedTurnItem[]) => {
    for (const entry of entries) {
      into.push({ kind: "work", id: entry.id, entry });
    }
  };

  const earliestTimestamp = (a: string, b: string): string => {
    const aMs = Date.parse(a);
    const bMs = Date.parse(b);
    if (Number.isNaN(aMs)) return b;
    if (Number.isNaN(bMs)) return a;
    return bMs < aMs ? b : a;
  };

  let newerUserBoundarySeen = false;
  for (let pass = rows.length - 1; pass >= 0; pass -= 1) {
    const row = rows[pass]!;
    if (row.kind === "message" && row.message.role === "user") {
      newerUserBoundarySeen = true;
      continue;
    }
    if (row.kind !== "message" || row.message.role !== "assistant") continue;
    const message = row.message;
    // Only the terminal message of a turn owns the collapsed group.
    if (!terminalAssistantMessageIds.has(message.id)) continue;
    // Never collapse while the terminal answer is still streaming.
    // Do NOT force-settle on message.completedAt alone — intermediate preambles
    // often complete mid-run and would flash Worked (9.7s) then re-open Working.
    if (message.streaming) continue;
    const turnId = message.turnId ?? null;

    // Pre-scan user boundary so we can resolve the stable activity id for sticky.
    let boundaryMessageId: MessageId | null = null;
    for (let scan = pass - 1; scan >= 0; scan -= 1) {
      const prev = rows[scan]!;
      if (prev.kind === "work") continue;
      if (prev.kind === "message" && prev.message.role === "assistant") continue;
      if (prev.kind === "proposed-plan") continue;
      if (prev.kind === "message" && prev.message.role === "user") {
        boundaryMessageId = prev.message.id;
      }
      break;
    }
    const activityId = turnActivityRowId(boundaryMessageId, turnId);
    const stickySettled = stickySettledActivityIds.has(activityId);
    const turnIsActive =
      activeTurnInProgress &&
      !newerUserBoundarySeen &&
      !stickySettled &&
      (activeTurnId != null
        ? (turnId != null && turnId === activeTurnId) ||
          message.id === lastTerminalAssistantMessageId
        : message.id === lastTerminalAssistantMessageId);
    if (turnIsActive) continue;

    // Scan back to the response boundary collecting rows to fold. Provider
    // mini-turns can have distinct turnIds inside one assistant answer, so the
    // user message boundary is the stable UI grouping point.
    const foldIndices: number[] = [];
    boundaryMessageId = null;
    for (let scan = pass - 1; scan >= 0; scan -= 1) {
      const prev = rows[scan]!;
      if (prev.kind === "work") {
        foldIndices.push(scan);
        continue;
      }
      if (prev.kind === "message" && prev.message.role === "assistant") {
        foldIndices.push(scan);
        continue;
      }
      if (prev.kind === "proposed-plan") {
        // The plan card stays visible, but it should not strand earlier
        // narration/work outside the final "Worked for..." disclosure.
        continue;
      }
      if (prev.kind === "message" && prev.message.role === "user") {
        boundaryMessageId = prev.message.id;
      }
      break;
    }
    foldIndices.reverse();

    const collapsedItems: CollapsedTurnItem[] = [];
    // The disclosure folds everything back to the user boundary, so "Worked
    // for" must start where the folded segment starts. The terminal row's own
    // durationStart advances past intermediate *completed* assistant messages
    // (e.g. a failed attempt before a retry), which would report only the tail
    // of the turn instead of the full run.
    let collapsedStart = row.durationStart;
    for (const index of foldIndices) {
      const folded = rows[index]!;
      if (folded.kind === "work") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.createdAt);
        collectWorkItems(folded.groupedEntries, collapsedItems);
      } else if (folded.kind === "message" && folded.message.role === "assistant") {
        collapsedStart = earliestTimestamp(collapsedStart, folded.durationStart);
        if (folded.assistantTurnDiffSummary) {
          row.assistantTurnDiffSummary = mergeTurnDiffSummaries(
            folded.assistantTurnDiffSummary,
            row.assistantTurnDiffSummary ?? folded.assistantTurnDiffSummary,
          );
        }
        if (folded.leadingWorkEntries) collectWorkItems(folded.leadingWorkEntries, collapsedItems);
        if (folded.collapsedTurnItems) collapsedItems.push(...folded.collapsedTurnItems);
        collapsedItems.push({ kind: "narration", id: folded.message.id, message: folded.message });
        if (folded.inlineWorkEntries) collectWorkItems(folded.inlineWorkEntries, collapsedItems);
      }
    }
    // The terminal's own work rows are details around the final answer; fold
    // them into the disclosure so completed chats do not end with tool-log rows.
    if (row.leadingWorkEntries) collectWorkItems(row.leadingWorkEntries, collapsedItems);
    if (row.inlineWorkEntries) collectWorkItems(row.inlineWorkEntries, collapsedItems);

    // ChatGPT only emits Worked for between *agent activity* and the final
    // answer. Pure text turns (hi → reply) keep no header and no disclosure.
    const hasAgentActivityInCollapse = collapsedItems.some(
      (item) => item.kind === "work" && isAgentWorkActivityEntry(item.entry),
    );
    if (!hasAgentActivityInCollapse) {
      // Leave intermediate assistant rows + terminal message inline; do not
      // invent an empty Worked-for divider.
      continue;
    }

    // Same origin as live Working (first agent-work item), not the user-send
    // durationStart — otherwise Worked jumps 10s → 20s vs the Working clock.
    let agentClockOrigin: string | null = null;
    for (const item of collapsedItems) {
      if (item.kind !== "work" || !isLiveStartedWorkEntry(item.entry)) continue;
      agentClockOrigin = agentClockOrigin
        ? earliestTimestamp(agentClockOrigin, item.entry.createdAt)
        : item.entry.createdAt;
    }
    const clockOrigin = agentClockOrigin ?? collapsedStart;
    const elapsed = formatElapsed(clockOrigin, message.completedAt);

    if (collapsedItems.length > 0) {
      row.collapsedTurnItems = collapsedItems;
      row.collapsedWorkElapsed = elapsed ?? null;
      delete row.leadingWorkEntries;
      delete row.leadingWorkGroupId;
      delete row.inlineWorkEntries;
      delete row.inlineWorkGroupId;
    }

    for (const index of foldIndices.toSorted((a, b) => b - a)) {
      rows.splice(index, 1);
    }
    const terminalIndex = pass - foldIndices.length;
    const settledId = turnActivityRowId(boundaryMessageId, turnId);
    rows.splice(terminalIndex, 0, {
      kind: "turn-activity",
      id: settledId,
      createdAt: clockOrigin,
      state: "settled",
      showReasoningStatus: false,
      ...(collapsedItems.length > 0 ? { collapsedTurnItems: collapsedItems } : {}),
      collapsedWorkElapsed: elapsed ?? null,
    });
    // Mark sticky only after a true idle settle so mid-run flaps do not
    // permanently lock Worked while the agent is still working.
    if (!activeTurnInProgress || stickySettled) {
      stickySettledActivityIds.add(settledId);
    }
    pass = terminalIndex;
  }
}

/**
 * ChatGPT `lHn` hasStartedWork for the *live* Working header: any non-user
 * work item after the user message (reasoning updates, thinking-tone status,
 * tools, info…). Pure wait with zero items stays Thinking.
 */
export function isLiveStartedWorkEntry(entry: WorkLogEntry): boolean {
  if (entry.veylenThreadCreation) return false;
  if (isReasoningUpdateWorkEntry(entry)) return true;
  // Thinking-tone status rows ("Planning…", progress phrases) also leave pure
  // wait — even when not labeled exactly "Reasoning summary".
  if (entry.tone === "thinking") return true;
  return isAgentWorkActivityEntry(entry);
}

/** Settled Worked-for / tool collapse: tools/info only — not pure reasoning. */
export function isAgentWorkActivityEntry(entry: WorkLogEntry): boolean {
  if (isReasoningUpdateWorkEntry(entry)) return false;
  if (entry.veylenThreadCreation) return false;
  if (entry.tone === "tool") return true;
  if (isSummarizableToolCallEntry(entry)) return true;
  // Info/error status rows (compaction, tasks updated, approvals) also leave
  // the pure-thinking phase and own a Working/Worked header.
  if (entry.tone === "info" || entry.tone === "error") return true;
  if (entry.subagentAction || (entry.subagents?.length ?? 0) > 0) return true;
  if (entry.automation) return true;
  return false;
}

// Reuses stable row references so streaming updates only invalidate rows whose
// visible content actually changed.
export function computeStableMessagesTimelineRows(
  rows: MessagesTimelineRow[],
  previous: StableMessagesTimelineRowsState,
): StableMessagesTimelineRowsState {
  const next = new Map<string, MessagesTimelineRow>();
  let anyChanged = rows.length !== previous.byId.size;

  const result = rows.map((row, index) => {
    const prevRow = previous.byId.get(row.id);
    const nextRow = prevRow && isRowUnchanged(prevRow, row) ? prevRow : row;
    next.set(row.id, nextRow);
    if (!anyChanged && previous.result[index] !== nextRow) {
      anyChanged = true;
    }
    return nextRow;
  });

  return anyChanged ? { byId: next, result } : previous;
}

function stringArraysEqual(
  left: ReadonlyArray<string> | undefined,
  right: ReadonlyArray<string> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function workLogSubagentActionsEqual(
  a: WorkLogEntry["subagentAction"],
  b: WorkLogEntry["subagentAction"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.tool === b.tool &&
    a.status === b.status &&
    a.summaryText === b.summaryText &&
    a.model === b.model &&
    a.prompt === b.prompt
  );
}

function workLogSubagentsEqual(
  left: WorkLogEntry["subagents"],
  right: WorkLogEntry["subagents"],
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((a, index) => {
    const b = right[index];
    return (
      b !== undefined &&
      a.threadId === b.threadId &&
      a.providerThreadId === b.providerThreadId &&
      a.resolvedThreadId === b.resolvedThreadId &&
      a.agentId === b.agentId &&
      a.nickname === b.nickname &&
      a.role === b.role &&
      a.model === b.model &&
      a.prompt === b.prompt &&
      a.rawStatus === b.rawStatus &&
      a.latestUpdate === b.latestUpdate &&
      a.title === b.title &&
      a.statusLabel === b.statusLabel &&
      a.isActive === b.isActive
    );
  });
}

// Automation card fields are visible row content, so stale equality would freeze the transcript UI.
function workLogAutomationsEqual(a: WorkLogEntry["automation"], b: WorkLogEntry["automation"]) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.cadenceLabel === b.cadenceLabel &&
    a.proposalState === b.proposalState
  );
}

function workLogVeylenThreadCreationsEqual(
  a: WorkLogEntry["veylenThreadCreation"],
  b: WorkLogEntry["veylenThreadCreation"],
) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.operationId !== b.operationId ||
    a.requestedCount !== b.requestedCount ||
    a.createdCount !== b.createdCount ||
    a.threads.length !== b.threads.length
  ) {
    return false;
  }
  return a.threads.every((thread, index) => {
    const other = b.threads[index];
    return (
      other !== undefined &&
      thread.threadId === other.threadId &&
      thread.title === other.title &&
      thread.provider === other.provider &&
      thread.model === other.model &&
      thread.environment === other.environment &&
      thread.status === other.status
    );
  });
}

function workLogToolOutputsEqual(
  a: NonNullable<WorkLogEntry["toolDetails"]>["output"],
  b: NonNullable<WorkLogEntry["toolDetails"]>["output"],
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.output === b.output &&
    a.stdout === b.stdout &&
    a.stderr === b.stderr &&
    a.exitCode === b.exitCode &&
    a.truncated === b.truncated
  );
}

function workLogToolEditsEqual(
  left: NonNullable<WorkLogEntry["toolDetails"]>["edits"],
  right: NonNullable<WorkLogEntry["toolDetails"]>["edits"],
) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((edit, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      edit.path === other.path &&
      edit.oldText === other.oldText &&
      edit.newText === other.newText
    );
  });
}

function workLogToolDetailsEqual(a: WorkLogEntry["toolDetails"], b: WorkLogEntry["toolDetails"]) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.title === b.title &&
    a.command === b.command &&
    a.diff === b.diff &&
    a.content === b.content &&
    stringArraysEqual(a.files, b.files) &&
    workLogToolOutputsEqual(a.output, b.output) &&
    workLogToolEditsEqual(a.edits, b.edits)
  );
}

function workLogLiveActivitiesEqual(
  a: WorkLogEntry["liveActivity"],
  b: WorkLogEntry["liveActivity"],
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.label === b.label &&
    a.startedAt === b.startedAt &&
    a.lastActivityAt === b.lastActivityAt &&
    a.detail === b.detail &&
    a.progress === b.progress &&
    a.elapsedSeconds === b.elapsedSeconds
  );
}

function workLogUserInputInteractionsEqual(
  a: WorkLogEntry["userInputInteraction"],
  b: WorkLogEntry["userInputInteraction"],
): boolean {
  if (a === b) return true;
  if (!a || !b || a.requestId !== b.requestId || a.questions.length !== b.questions.length) {
    return false;
  }
  for (let index = 0; index < a.questions.length; index += 1) {
    const left = a.questions[index]!;
    const right = b.questions[index]!;
    if (
      left.id !== right.id ||
      left.header !== right.header ||
      left.question !== right.question ||
      left.multiSelect !== right.multiSelect ||
      left.options.length !== right.options.length
    ) {
      return false;
    }
    for (let optionIndex = 0; optionIndex < left.options.length; optionIndex += 1) {
      const leftOption = left.options[optionIndex]!;
      const rightOption = right.options[optionIndex]!;
      if (
        leftOption.label !== rightOption.label ||
        leftOption.description !== rightOption.description
      ) {
        return false;
      }
    }
  }

  const leftAnswers = a.answers;
  const rightAnswers = b.answers;
  if (leftAnswers === rightAnswers) return true;
  if (!leftAnswers || !rightAnswers) return false;
  const leftAnswerKeys = Object.keys(leftAnswers);
  if (leftAnswerKeys.length !== Object.keys(rightAnswers).length) return false;
  return leftAnswerKeys.every((questionId) => {
    const leftAnswer = leftAnswers[questionId];
    const rightAnswer = rightAnswers[questionId];
    if (Array.isArray(leftAnswer) && Array.isArray(rightAnswer)) {
      return stringArraysEqual(leftAnswer, rightAnswer);
    }
    return leftAnswer === rightAnswer;
  });
}

function workLogEntryContentEqual(a: WorkLogEntry, b: WorkLogEntry): boolean {
  return (
    a.id === b.id &&
    a.createdAt === b.createdAt &&
    a.turnId === b.turnId &&
    a.label === b.label &&
    a.detail === b.detail &&
    a.toolTitle === b.toolTitle &&
    a.command === b.command &&
    a.rawCommand === b.rawCommand &&
    a.preview === b.preview &&
    a.tone === b.tone &&
    a.itemType === b.itemType &&
    a.requestKind === b.requestKind &&
    a.activityKind === b.activityKind &&
    a.toolName === b.toolName &&
    a.toolCallId === b.toolCallId &&
    a.toolStatus === b.toolStatus &&
    stringArraysEqual(a.changedFiles, b.changedFiles) &&
    workLogSubagentActionsEqual(a.subagentAction, b.subagentAction) &&
    workLogSubagentsEqual(a.subagents, b.subagents) &&
    workLogAutomationsEqual(a.automation, b.automation) &&
    workLogVeylenThreadCreationsEqual(a.veylenThreadCreation, b.veylenThreadCreation) &&
    workLogLiveActivitiesEqual(a.liveActivity, b.liveActivity) &&
    workLogUserInputInteractionsEqual(a.userInputInteraction, b.userInputInteraction) &&
    workLogToolDetailsEqual(a.toolDetails, b.toolDetails)
  );
}

function workLogEntryArraysEqual(
  left: ReadonlyArray<WorkLogEntry> | undefined,
  right: ReadonlyArray<WorkLogEntry> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((entry, index) => workLogEntryContentEqual(entry, right[index]!));
}

function collapsedTurnItemsEqual(
  left: ReadonlyArray<CollapsedTurnItem> | undefined,
  right: ReadonlyArray<CollapsedTurnItem> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index]!;
    if (item.kind !== other.kind || item.id !== other.id) return false;
    if (item.kind === "work" && other.kind === "work") {
      return workLogEntryContentEqual(item.entry, other.entry);
    }
    if (item.kind === "narration" && other.kind === "narration") {
      return item.message === other.message;
    }
    return false;
  });
}

function isRowUnchanged(a: MessagesTimelineRow, b: MessagesTimelineRow): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;

  switch (a.kind) {
    case "turn-activity": {
      const ba = b as typeof a;
      return (
        a.createdAt === ba.createdAt &&
        a.state === ba.state &&
        a.showReasoningStatus === ba.showReasoningStatus &&
        workLogEntryArraysEqual(a.reasoningEntries, ba.reasoningEntries) &&
        a.collapsedWorkElapsed === ba.collapsedWorkElapsed &&
        collapsedTurnItemsEqual(a.collapsedTurnItems, ba.collapsedTurnItems)
      );
    }

    case "reasoning-status": {
      const br = b as typeof a;
      return (
        a.scopeKey === br.scopeKey &&
        workLogEntryArraysEqual(a.reasoningEntries, br.reasoningEntries)
      );
    }

    case "worktree-setup": {
      const bw = b as typeof a;
      return (
        a.open === bw.open &&
        a.steps.length === bw.steps.length &&
        a.steps.every((step, index) => {
          const other = bw.steps[index]!;
          return step.id === other.id && step.status === other.status && step.label === other.label;
        })
      );
    }

    case "proposed-plan":
      return a.proposedPlan === (b as typeof a).proposedPlan;

    case "work":
      return (
        a.createdAt === (b as typeof a).createdAt &&
        workLogEntryArraysEqual(a.groupedEntries, (b as typeof a).groupedEntries)
      );

    case "message": {
      const bm = b as typeof a;
      return (
        a.message === bm.message &&
        workLogEntryArraysEqual(a.leadingWorkEntries, bm.leadingWorkEntries) &&
        a.leadingWorkGroupId === bm.leadingWorkGroupId &&
        workLogEntryArraysEqual(a.inlineWorkEntries, bm.inlineWorkEntries) &&
        a.inlineWorkGroupId === bm.inlineWorkGroupId &&
        collapsedTurnItemsEqual(a.collapsedTurnItems, bm.collapsedTurnItems) &&
        a.collapsedWorkElapsed === bm.collapsedWorkElapsed &&
        a.durationStart === bm.durationStart &&
        a.showAssistantCopyButton === bm.showAssistantCopyButton &&
        a.assistantCopyStreaming === bm.assistantCopyStreaming &&
        a.assistantTurnInProgress === bm.assistantTurnInProgress &&
        a.assistantTurnDiffSummary === bm.assistantTurnDiffSummary &&
        a.revertTurnCount === bm.revertTurnCount
      );
    }
  }
}
