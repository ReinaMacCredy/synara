// FILE: pendingUserInputAdvisor.ts
// Purpose: Build and parse bounded Advisor consultations for pending user-input options.
// Layer: Web chat state utility

import type { UserInputQuestion } from "@veylen/contracts";

import {
  getPendingUserInputOptionNote,
  type PendingUserInputDraftAnswer,
} from "./pendingUserInput";

export const PENDING_USER_INPUT_ADVISOR_MARKER = "VEYLEN_PENDING_USER_INPUT_ADVISOR_V1";

export interface PendingUserInputAdvisorRecommendation {
  optionLabel: string;
  reason: string;
}

export function isPendingUserInputAdvisorQuestion(value: string | null | undefined): boolean {
  return value?.split(/\r?\n/, 1)[0]?.trim() === PENDING_USER_INPUT_ADVISOR_MARKER;
}

export function extractPendingUserInputAdvisorQuestion(
  value: string | null | undefined,
): string | null {
  if (!isPendingUserInputAdvisorQuestion(value)) {
    return null;
  }
  const match = value?.match(/(?:^|\r?\n)Question:\s*([\s\S]*?)\r?\nAvailable options:/);
  const question = match?.[1]?.trim() ?? "";
  return question.length > 0 ? question : null;
}

export function isPendingUserInputAdvisorQuestionFor(
  value: string | null | undefined,
  question: string,
): boolean {
  return extractPendingUserInputAdvisorQuestion(value) === question.trim();
}

export function shouldShowPendingUserInputAdvisorConsultation(
  value: string | null | undefined,
  pendingQuestions: ReadonlyArray<string>,
): boolean {
  return (
    !isPendingUserInputAdvisorQuestion(value) ||
    pendingQuestions.some((question) => isPendingUserInputAdvisorQuestionFor(value, question))
  );
}

export function pendingUserInputAdvisorContextFingerprint(
  draft: PendingUserInputDraftAnswer | undefined,
): string {
  const selectedOptionLabels = draft?.selectedOptionLabels ?? [];
  const optionNotes = Object.fromEntries(
    selectedOptionLabels.map((label) => [label, getPendingUserInputOptionNote(draft, label)]),
  );
  return JSON.stringify({ selectedOptionLabels, optionNotes });
}

export function buildPendingUserInputAdvisorQuestion(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string {
  const options = question.options.map((option, index) => {
    const description = option.description?.trim();
    return `${index + 1}. ${option.label}${description ? ` — ${description}` : ""}`;
  });
  const selectedNotes = (draft?.selectedOptionLabels ?? [])
    .map((label) => ({ label, note: getPendingUserInputOptionNote(draft, label).trim() }))
    .filter((entry) => entry.note.length > 0)
    .map((entry) => `- ${entry.label}: ${entry.note}`);

  return [
    PENDING_USER_INPUT_ADVISOR_MARKER,
    "Choose the single best option for this pending agent question.",
    `Question: ${question.question}`,
    "Available options:",
    ...options,
    ...(selectedNotes.length > 0 ? ["User notes:", ...selectedNotes] : []),
    "Response requirements:",
    "- The first non-empty line must be exactly one option label from the list above.",
    "- Follow with one brief reason for that choice.",
    "- Do not submit the response or propose a different option.",
  ].join("\n");
}

function stripRecommendationDecoration(value: string): string {
  return value
    .trim()
    .replace(/^(?:[-*>#]+\s*)+/, "")
    .replace(/^(?:recommendation|recommended option|answer)\s*:\s*/i, "")
    .replace(/[`*_]/g, "")
    .trim();
}

function stripRecommendedSuffix(value: string): string {
  return value.replace(/\s*\(recommended\)\s*$/i, "").trim();
}

function matchesOptionLabel(line: string, label: string): boolean {
  const lowerLine = line.toLocaleLowerCase();
  const lowerLabel = label.toLocaleLowerCase();
  return (
    lowerLine === lowerLabel ||
    lowerLine.startsWith(`${lowerLabel}:`) ||
    lowerLine.startsWith(`${lowerLabel} -`) ||
    lowerLine.startsWith(`${lowerLabel} —`)
  );
}

export function parsePendingUserInputAdvisorRecommendation(
  answer: string | null | undefined,
  optionLabels: ReadonlyArray<string>,
): PendingUserInputAdvisorRecommendation | null {
  const lines = answer
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!lines || lines.length === 0) {
    return null;
  }

  const firstLine = stripRecommendationDecoration(lines[0]!);
  const candidates = [...optionLabels]
    .map((optionLabel) => ({ optionLabel, matchedLabel: optionLabel.trim() }))
    .sort((left, right) => right.matchedLabel.length - left.matchedLabel.length);
  const exactMatch = candidates.find(({ matchedLabel }) =>
    matchesOptionLabel(firstLine, matchedLabel),
  );
  const recommendationOmittedMatch = exactMatch
    ? undefined
    : candidates
        .map(({ optionLabel }) => ({
          optionLabel,
          matchedLabel: stripRecommendedSuffix(optionLabel),
        }))
        .filter(({ optionLabel, matchedLabel }) => matchedLabel !== optionLabel.trim())
        .find(({ matchedLabel }) => matchesOptionLabel(firstLine, matchedLabel));
  const match = exactMatch ?? recommendationOmittedMatch;
  if (!match) {
    return null;
  }

  const inlineReason = firstLine.slice(match.matchedLabel.length).replace(/^\s*(?::|-|—)\s*/, "");
  const reason = [inlineReason, ...lines.slice(1)].filter(Boolean).join(" ").replace(/\s+/g, " ");
  return {
    optionLabel: match.optionLabel,
    reason: reason || `Advisor recommends ${match.optionLabel}.`,
  };
}
