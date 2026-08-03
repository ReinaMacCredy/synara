// FILE: advisorConsultation.ts
// Purpose: Derive durable Advisor UI state from projected child threads.

import type { ThreadId } from "@synara/contracts";
import {
  extractAdvisorConsultationQuestion,
  isAdvisorIdentity,
} from "@synara/shared/advisor";

import type { Thread, ThreadShell } from "../types";

export type AdvisorConsultationStatus = "running" | "complete" | "stopped" | "error";

export interface AdvisorConsultation {
  threadId: ThreadId;
  question: string;
  answer: string | null;
  answerStreaming: boolean;
  error: string | null;
  status: AdvisorConsultationStatus;
}

export function buildAdvisorThreadTitle(question: string): string {
  const normalized = question.trim().replace(/\s+/g, " ");
  const suffix = normalized.length > 52 ? `${normalized.slice(0, 49).trimEnd()}…` : normalized;
  return suffix.length > 0 ? `Advisor: ${suffix}` : "Advisor";
}

export function findLatestAdvisorThreadShell(
  shells: ReadonlyArray<ThreadShell>,
  parentThreadId: ThreadId | null,
): ThreadShell | null {
  if (!parentThreadId) return null;
  let latest: ThreadShell | null = null;
  for (const shell of shells) {
    if (
      shell.parentThreadId !== parentThreadId ||
      !isAdvisorIdentity({
        nickname: shell.subagentNickname,
        role: shell.subagentRole,
        title: shell.title,
      })
    ) {
      continue;
    }
    if (!latest || Date.parse(shell.createdAt) > Date.parse(latest.createdAt)) {
      latest = shell;
    }
  }
  return latest;
}

export function deriveAdvisorConsultation(thread: Thread | undefined): AdvisorConsultation | null {
  if (!thread) return null;
  const questionMessageIndex = thread.messages.findLastIndex(
    (message) => message.role === "user" && extractAdvisorConsultationQuestion(message.text) !== null,
  );
  const questionMessage =
    questionMessageIndex >= 0 ? thread.messages[questionMessageIndex] : undefined;
  const question =
    extractAdvisorConsultationQuestion(questionMessage?.text) ?? "Agent requested a second opinion.";
  const answerMessage = thread.messages
    .slice(questionMessageIndex + 1)
    .findLast((message) => message.role === "assistant");
  const answer = answerMessage?.text.trim() || null;
  const latestTurnState = thread.latestTurn?.state;
  const sessionError =
    thread.session?.orchestrationStatus === "error" ? (thread.session.lastError ?? null) : null;
  const error = thread.error ?? sessionError;
  let status: AdvisorConsultationStatus = "running";
  if (error || latestTurnState === "error") {
    status = "error";
  } else if (latestTurnState === "interrupted") {
    status = "stopped";
  } else if (latestTurnState === "completed") {
    status = "complete";
  }

  return {
    threadId: thread.id,
    question,
    answer,
    answerStreaming: answerMessage?.streaming ?? false,
    error,
    status,
  };
}

export function advisorDraftInsertion(answer: string): string {
  return `Advisor recommendation:\n\n${answer.trim()}`;
}
