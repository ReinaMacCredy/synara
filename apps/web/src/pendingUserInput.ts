// FILE: pendingUserInput.ts
// Purpose: Normalize draft answers and progress for pending user input prompts.
// Layer: Web chat state utility
// Exports: Draft answer helpers and progress derivation used by ChatView/composer panels.

import type { ProviderUserInputAnswers, UserInputQuestion } from "@synara/contracts";

export interface PendingUserInputDraftAnswer {
  selectedOptionLabels?: string[];
  customAnswer?: string;
  optionNotes?: Record<string, string>;
}

export interface PendingUserInputProgress {
  questionIndex: number;
  activeQuestion: UserInputQuestion | null;
  activeDraft: PendingUserInputDraftAnswer | undefined;
  selectedOptionLabels: string[];
  customAnswer: string;
  resolvedAnswer: string | string[] | null;
  usingCustomAnswer: boolean;
  answeredQuestionCount: number;
  isLastQuestion: boolean;
  isComplete: boolean;
  canAdvance: boolean;
}

function normalizeDraftAnswer(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Normalize option selections so UI and submit logic can share one canonical list.
function normalizeSelectedOptionLabels(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return Array.from(new Set(normalized));
}

function normalizeOptionNotes(value: Record<string, string> | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] =>
        entry[0].trim().length > 0 && typeof entry[1] === "string" && entry[1].trim().length > 0,
    ),
  );
}

function resolveOptionAnswer(label: string, optionNotes: Record<string, string>): string {
  const note = normalizeDraftAnswer(optionNotes[label]);
  return note ? `${label}\nNote for agent: ${note}` : label;
}

export function getPendingUserInputOptionNote(
  draft: PendingUserInputDraftAnswer | undefined,
  optionLabel: string,
): string {
  return draft?.optionNotes?.[optionLabel] ?? "";
}

export function setPendingUserInputOptionNote(
  draft: PendingUserInputDraftAnswer | undefined,
  optionLabel: string,
  note: string,
): PendingUserInputDraftAnswer {
  const normalizedLabel = optionLabel.trim();
  const optionNotes = normalizeOptionNotes(draft?.optionNotes);
  if (normalizedLabel.length > 0 && note.trim().length > 0) {
    optionNotes[normalizedLabel] = note;
  } else if (normalizedLabel.length > 0) {
    delete optionNotes[normalizedLabel];
  }

  const nextDraft = { ...draft };
  if (Object.keys(optionNotes).length > 0) {
    nextDraft.optionNotes = optionNotes;
  } else {
    delete nextDraft.optionNotes;
  }
  return nextDraft;
}

export function resolvePendingUserInputAnswer(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string | string[] | null {
  const customAnswer = normalizeDraftAnswer(draft?.customAnswer);
  if (customAnswer) {
    return customAnswer;
  }

  const selectedOptionLabels = normalizeSelectedOptionLabels(draft?.selectedOptionLabels);
  const optionNotes = normalizeOptionNotes(draft?.optionNotes);
  if (question.multiSelect) {
    return selectedOptionLabels.length > 0
      ? selectedOptionLabels.map((label) => resolveOptionAnswer(label, optionNotes))
      : null;
  }

  const selectedOptionLabel = selectedOptionLabels[0];
  return selectedOptionLabel ? resolveOptionAnswer(selectedOptionLabel, optionNotes) : null;
}

export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string,
): PendingUserInputDraftAnswer {
  const selectedOptionLabels =
    customAnswer.trim().length > 0
      ? undefined
      : normalizeSelectedOptionLabels(draft?.selectedOptionLabels);
  const optionNotes = normalizeOptionNotes(draft?.optionNotes);

  return {
    customAnswer,
    ...(selectedOptionLabels && selectedOptionLabels.length > 0 ? { selectedOptionLabels } : {}),
    ...(Object.keys(optionNotes).length > 0 ? { optionNotes } : {}),
  };
}

// Toggle selections in-place so multi-select prompts can keep the same draft state shape.
export function togglePendingUserInputOptionSelection(
  question: UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
  optionLabel: string,
): PendingUserInputDraftAnswer {
  const optionNotes = normalizeOptionNotes(draft?.optionNotes);
  if (question.multiSelect) {
    const selectedOptionLabels = normalizeSelectedOptionLabels(draft?.selectedOptionLabels);
    const nextSelectedOptionLabels = selectedOptionLabels.includes(optionLabel)
      ? selectedOptionLabels.filter((label) => label !== optionLabel)
      : [...selectedOptionLabels, optionLabel];

    return {
      customAnswer: "",
      ...(nextSelectedOptionLabels.length > 0
        ? { selectedOptionLabels: nextSelectedOptionLabels }
        : {}),
      ...(Object.keys(optionNotes).length > 0 ? { optionNotes } : {}),
    };
  }

  return {
    customAnswer: "",
    selectedOptionLabels: [optionLabel],
    ...(Object.keys(optionNotes).length > 0 ? { optionNotes } : {}),
  };
}

export function buildPendingUserInputAnswers(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): Record<string, string | string[]> | null {
  const answers: Record<string, string | string[]> = {};

  for (const question of questions) {
    const answer = resolvePendingUserInputAnswer(question, draftAnswers[question.id]);
    if (!answer) {
      return null;
    }
    answers[question.id] = answer;
  }

  return answers;
}

export function hasCompletePendingUserInputAnswers(answers: ProviderUserInputAnswers): boolean {
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return false;
  }

  return entries.every(([, answer]) => {
    if (typeof answer === "string") {
      return answer.trim().length > 0;
    }

    if (Array.isArray(answer)) {
      return answer.some((entry) => typeof entry === "string" && entry.trim().length > 0);
    }

    return false;
  });
}

export function omitNullPendingUserInputAnswers(
  answers: ProviderUserInputAnswers,
): ProviderUserInputAnswers {
  return Object.fromEntries(
    Object.entries(answers).filter(([, answer]) => answer !== null && answer !== undefined),
  );
}

export function countAnsweredPendingUserInputQuestions(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  return questions.reduce((count, question) => {
    return resolvePendingUserInputAnswer(question, draftAnswers[question.id]) ? count + 1 : count;
  }, 0);
}

export function findFirstUnansweredPendingUserInputQuestionIndex(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  const unansweredIndex = questions.findIndex(
    (question) => !resolvePendingUserInputAnswer(question, draftAnswers[question.id]),
  );

  return unansweredIndex === -1 ? Math.max(questions.length - 1, 0) : unansweredIndex;
}

export function derivePendingUserInputProgress(
  questions: ReadonlyArray<UserInputQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
): PendingUserInputProgress {
  const normalizedQuestionIndex =
    questions.length === 0 ? 0 : Math.max(0, Math.min(questionIndex, questions.length - 1));
  const activeQuestion = questions[normalizedQuestionIndex] ?? null;
  const activeDraft = activeQuestion ? draftAnswers[activeQuestion.id] : undefined;
  const resolvedAnswer = activeQuestion
    ? resolvePendingUserInputAnswer(activeQuestion, activeDraft)
    : null;
  const customAnswer = activeDraft?.customAnswer ?? "";
  const answeredQuestionCount = countAnsweredPendingUserInputQuestions(questions, draftAnswers);
  const isLastQuestion =
    questions.length === 0 ? true : normalizedQuestionIndex >= questions.length - 1;

  return {
    questionIndex: normalizedQuestionIndex,
    activeQuestion,
    activeDraft,
    selectedOptionLabels: normalizeSelectedOptionLabels(activeDraft?.selectedOptionLabels),
    customAnswer,
    resolvedAnswer,
    usingCustomAnswer: customAnswer.trim().length > 0,
    answeredQuestionCount,
    isLastQuestion,
    isComplete: buildPendingUserInputAnswers(questions, draftAnswers) !== null,
    canAdvance: Boolean(resolvedAnswer),
  };
}
