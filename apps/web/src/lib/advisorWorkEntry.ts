// FILE: advisorWorkEntry.ts
// Purpose: Detect agent-invoked Advisor collab tool rows and extract presentation fields.
// Layer: Web chat helpers (shared by work-log routing and timeline rendering)

import {
  extractAdvisorConsultationQuestion,
  isAdvisorConsultationPrompt,
  isAdvisorIdentity,
} from "@veylen/shared/advisor";

import type { WorkLogEntry, WorkLogSubagent } from "../session-logic";

export type AdvisorWorkEntryStatus = "running" | "complete" | "error" | "stopped";

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function isAdvisorSubagent(
  subagent: Pick<WorkLogSubagent, "nickname" | "role" | "title">,
): boolean {
  return isAdvisorIdentity({
    nickname: subagent.nickname,
    role: subagent.role,
    title: subagent.title,
  });
}

function normalizeToolName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** True when a work row is an agent-invoked Advisor consultation (type 3). */
export function isAdvisorConsultationWorkEntry(
  entry: Pick<
    WorkLogEntry,
    | "itemType"
    | "subagents"
    | "subagentAction"
    | "detail"
    | "preview"
    | "label"
    | "toolName"
    | "toolTitle"
  >,
): boolean {
  // Preferred path: Veylen gateway tool (same fork pipeline as type 1/2).
  const toolName = normalizeToolName(entry.toolName);
  const toolTitle = normalizeToolName(entry.toolTitle);
  const label = normalizeToolName(entry.label);
  if (
    toolName.includes("consult_advisor") ||
    toolTitle.includes("consult_advisor") ||
    label.includes("consult_advisor") ||
    toolName.endsWith("asking_advisor") ||
    toolTitle.includes("asking_advisor") ||
    label.includes("got_a_second_opinion")
  ) {
    return true;
  }

  // Legacy collab spawn path (pre-gateway tool).
  if (entry.itemType === "collab_agent_tool_call") {
    if ((entry.subagents ?? []).some(isAdvisorSubagent)) {
      return true;
    }
    const promptCandidates = [
      entry.subagentAction?.prompt,
      entry.detail,
      entry.preview,
      entry.label,
    ];
    return promptCandidates.some((value) => isAdvisorConsultationPrompt(value));
  }
  return false;
}

export function advisorWorkEntryStatus(
  entry: Pick<WorkLogEntry, "toolStatus" | "liveActivity" | "tone">,
): AdvisorWorkEntryStatus {
  if (entry.toolStatus === "failed" || entry.tone === "error") {
    return "error";
  }
  if (entry.toolStatus === "completed") {
    return "complete";
  }
  const live = entry.liveActivity?.state;
  if (live === "failed") return "error";
  if (live === "cancelled") return "stopped";
  if (live === "completed") return "complete";
  return "running";
}

function tryParseAdvisorToolJson(value: string | null | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function extractAdvisorWorkEntryQuestion(
  entry: Pick<WorkLogEntry, "subagentAction" | "detail" | "preview" | "label" | "subagents">,
): string | null {
  const fromPrompt = extractAdvisorConsultationQuestion(entry.subagentAction?.prompt);
  if (fromPrompt) return fromPrompt;

  for (const subagent of entry.subagents ?? []) {
    const fromSubagent = extractAdvisorConsultationQuestion(subagent.prompt);
    if (fromSubagent) return fromSubagent;
  }

  // Gateway tool result/input may be JSON with a question field.
  for (const candidate of [entry.detail, entry.preview, entry.label]) {
    const json = tryParseAdvisorToolJson(candidate);
    const question = typeof json?.question === "string" ? json.question.trim() : "";
    if (question) return question;
  }

  // Non-marker fallback: short human prompt without the full consultation contract.
  const fallback = firstNonEmpty(
    entry.subagentAction?.prompt,
    entry.subagents?.[0]?.prompt,
    entry.preview,
    entry.label,
  );
  if (
    fallback &&
    !isAdvisorConsultationPrompt(fallback) &&
    !fallback.startsWith("{") &&
    !normalizeToolName(fallback).includes("consult_advisor") &&
    !normalizeToolName(fallback).includes("asking_advisor") &&
    !normalizeToolName(fallback).includes("got_a_second_opinion") &&
    !normalizeToolName(fallback).includes("loaded_tools")
  ) {
    return fallback.length > 160 ? `${fallback.slice(0, 157).trimEnd()}…` : fallback;
  }
  // Never invent placeholder prose when the real question is unknown.
  return null;
}

export function extractAdvisorWorkEntryAdvice(
  entry: Pick<WorkLogEntry, "detail" | "preview" | "toolStatus" | "tone">,
): string | null {
  // Allow partial advice while the tool is still running (streaming into detail).
  for (const candidate of [entry.detail, entry.preview]) {
    const json = tryParseAdvisorToolJson(candidate);
    const advice = typeof json?.advice === "string" ? json.advice.trim() : "";
    if (advice) return advice;
  }
  if (entry.toolStatus === "failed" || entry.tone === "error") {
    return null;
  }
  const advice = firstNonEmpty(entry.detail, entry.preview);
  if (!advice || isAdvisorConsultationPrompt(advice) || advice.startsWith("{")) {
    return null;
  }
  return advice;
}

export function advisorWorkEntryThreadId(
  entry: Pick<WorkLogEntry, "subagents" | "detail" | "preview">,
): string | null {
  for (const subagent of entry.subagents ?? []) {
    const id = firstNonEmpty(
      subagent.resolvedThreadId,
      subagent.threadId,
      subagent.providerThreadId,
    );
    if (id) return id;
  }
  for (const candidate of [entry.detail, entry.preview]) {
    const json = tryParseAdvisorToolJson(candidate);
    const threadId = typeof json?.threadId === "string" ? json.threadId.trim() : "";
    if (threadId) return threadId;
  }
  return null;
}

export function workEntryReferencesAdvisorThread(
  entry: Pick<
    WorkLogEntry,
    "itemType" | "subagents" | "subagentAction" | "detail" | "preview" | "label"
  >,
  threadId: string,
): boolean {
  if (!isAdvisorConsultationWorkEntry(entry)) return false;
  const target = threadId.trim();
  if (!target) return false;
  return (entry.subagents ?? []).some((subagent) => {
    const ids = [subagent.resolvedThreadId, subagent.threadId, subagent.providerThreadId]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return ids.includes(target);
  });
}

/** True when a work entry is the agent-invoked source for this consultation. */
export function workEntryMatchesAdvisorConsultation(
  entry: Pick<
    WorkLogEntry,
    "itemType" | "subagents" | "subagentAction" | "detail" | "preview" | "label"
  >,
  consultation: { threadId: string; question: string },
): boolean {
  if (!isAdvisorConsultationWorkEntry(entry)) return false;
  if (workEntryReferencesAdvisorThread(entry, consultation.threadId)) {
    return true;
  }
  // Thread ids can lag native spawn → projection; fall back to question text.
  const entryQuestion = extractAdvisorWorkEntryQuestion(entry)?.trim() ?? "";
  const consultationQuestion = consultation.question.trim();
  return entryQuestion.length > 0 && entryQuestion === consultationQuestion;
}
