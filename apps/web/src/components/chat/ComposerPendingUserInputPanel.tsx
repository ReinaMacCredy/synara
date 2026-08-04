// FILE: ComposerPendingUserInputPanel.tsx
// Purpose: Detached beUI-style question card for Codex request_user_input prompts.
// Layer: Chat composer UI
// Exports: ComposerPendingUserInputPanel

import { useEffect, useEffectEvent, useRef } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleQuestionIcon,
  LoaderCircleIcon,
} from "~/lib/icons";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => PendingUserInputDraftAnswer | null;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onAdvance: (answerOverrides?: Record<string, PendingUserInputDraftAnswer>) => void;
  onPrevious: () => void;
}

export function ComposerPendingUserInputPanel({
  pendingUserInputs,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onCustomAnswerChange,
  onAdvance,
  onPrevious,
}: PendingUserInputPanelProps) {
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={`${activePrompt.requestId}:${activePrompt.lifecycleGeneration ?? "legacy"}`}
      prompt={activePrompt}
      isResponding={isResponding}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onCustomAnswerChange={onCustomAnswerChange}
      onAdvance={onAdvance}
      onPrevious={onPrevious}
    />
  );
}

function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onCustomAnswerChange,
  onAdvance,
  onPrevious,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionLabel: string) => PendingUserInputDraftAnswer | null;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onAdvance: (answerOverrides?: Record<string, PendingUserInputDraftAnswer>) => void;
  onPrevious: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const selectedOptionLabelSet = new Set(progress.selectedOptionLabels);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const onAdvanceRef = useRef(onAdvance);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [activeQuestion?.id, isResponding]);

  const handleOptionSelection = (questionId: string, optionLabel: string) => {
    const nextDraftAnswer = onToggleOption(questionId, optionLabel);
    if (
      activeQuestion?.multiSelect ||
      progress.isLastQuestion ||
      isResponding ||
      !nextDraftAnswer
    ) {
      return;
    }
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onAdvanceRef.current({ [questionId]: nextDraftAnswer });
    }, 240);
  };
  const handleEffectOptionSelection = useEffectEvent(handleOptionSelection);

  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const option = activeQuestion.options[digit - 1];
      if (!option) return;
      event.preventDefault();
      handleEffectOptionSelection(activeQuestion.id, option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, isResponding]);

  if (!activeQuestion) return null;

  const questionCount = prompt.questions.length;
  const canGoBack = progress.questionIndex > 0 && !isResponding;
  const canContinue = progress.canAdvance && !isResponding;

  return (
    <section
      data-state={isResponding ? "submitting" : "pending"}
      aria-busy={isResponding}
      aria-labelledby={`user-input-question-${activeQuestion.id}`}
      className="w-full overflow-hidden rounded-2xl bg-muted p-4 text-sm"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-5 shrink-0 place-items-center text-muted-foreground"
        >
          {isResponding ? (
            <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <CircleQuestionIcon className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="mb-0.5 text-[11px] font-medium text-muted-foreground/70">
                {activeQuestion.header}
              </p>
              <h3
                id={`user-input-question-${activeQuestion.id}`}
                className="text-base font-medium leading-5 text-foreground"
              >
                {activeQuestion.question}
              </h3>
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground/65">
              {progress.questionIndex + 1}/{questionCount}
            </span>
          </div>

          {activeQuestion.multiSelect ? (
            <p className="mt-1 leading-5 text-muted-foreground">
              Select every option that applies.
            </p>
          ) : null}

          {activeQuestion.options.length > 0 ? (
            <div className="mt-3 grid gap-0.5">
              {activeQuestion.options.map((option) => {
                const selected = selectedOptionLabelSet.has(option.label);
                return (
                  <label
                    key={`${activeQuestion.id}:${option.label}`}
                    className={cn(
                      "group flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1.5 outline-none transition-colors",
                      selected
                        ? "bg-[var(--color-background-button-secondary)]"
                        : "hover:bg-[var(--color-background-button-secondary-hover)]",
                      isResponding && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-4 shrink-0 place-items-center border transition-colors",
                        activeQuestion.multiSelect ? "rounded-[4px]" : "rounded-full",
                        selected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background",
                      )}
                    >
                      {selected ? (
                        activeQuestion.multiSelect ? (
                          <CheckIcon className="size-3" />
                        ) : (
                          <span className="size-1.5 rounded-full bg-current" />
                        )
                      ) : null}
                    </span>
                    <input
                      type={activeQuestion.multiSelect ? "checkbox" : "radio"}
                      name={`user-input-${activeQuestion.id}`}
                      checked={selected}
                      disabled={isResponding}
                      onChange={() => handleOptionSelection(activeQuestion.id, option.label)}
                      className="sr-only"
                    />
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="block text-[13px] text-foreground/90">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-[11.5px] text-muted-foreground/65">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}

          <Input
            nativeInput
            value={progress.customAnswer}
            disabled={isResponding}
            aria-label={`Custom answer for ${activeQuestion.question}`}
            placeholder="Type another answer…"
            onChange={(event) => onCustomAnswerChange(activeQuestion.id, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !canContinue) return;
              event.preventDefault();
              onAdvance();
            }}
            className={cn(
              "h-10 rounded-xl border-0 bg-background/70 focus-within:bg-background",
              activeQuestion.options.length > 0 && "mt-2",
            )}
          />

          <div className="mt-4 flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              shape="capsule"
              aria-label="Previous question"
              disabled={!canGoBack}
              onClick={onPrevious}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>

            <span className="flex gap-1.5" aria-hidden="true">
              {prompt.questions.map((question, index) => (
                <span
                  key={question.id}
                  className={cn(
                    "size-1.5 rounded-full bg-foreground transition-[opacity,transform] duration-220 ease-out motion-reduce:transition-none",
                    index === progress.questionIndex ? "scale-100 opacity-100" : "scale-75",
                    index <= progress.questionIndex ? "opacity-100" : "opacity-35",
                  )}
                />
              ))}
            </span>
            <span className="sr-only">
              Question {progress.questionIndex + 1} of {questionCount}
            </span>

            <Button
              size={progress.isLastQuestion ? "sm" : "icon-sm"}
              shape="capsule"
              aria-label={progress.isLastQuestion ? "Submit response" : "Next question"}
              disabled={!canContinue}
              onClick={() => onAdvance()}
              className="ml-auto"
            >
              {isResponding ? (
                <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
              ) : progress.isLastQuestion ? (
                <>
                  Submit response
                  <ArrowRightIcon className="size-3.5" />
                </>
              ) : (
                <ArrowRightIcon className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
