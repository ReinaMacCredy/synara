// FILE: ComposerPendingUserInputPanel.tsx
// Purpose: Detached beUI-style question card for Codex request_user_input prompts.
// Layer: Chat composer UI
// Exports: ComposerPendingUserInputPanel, ComposerPendingUserInputPanelPresence

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  getPendingUserInputOptionNote,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import {
  buildPendingUserInputAdvisorQuestion,
  isPendingUserInputAdvisorQuestionFor,
  parsePendingUserInputAdvisorRecommendation,
  pendingUserInputAdvisorContextFingerprint,
} from "../../pendingUserInputAdvisor";
import type { AdvisorConsultation } from "~/lib/advisorConsultation";
import { Button } from "~/components/ui/button";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Input } from "~/components/ui/input";
import { Kbd } from "~/components/ui/kbd";
import {
  AdvisorIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  CircleQuestionIcon,
  LoaderCircleIcon,
} from "~/lib/icons";
import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  advisorConsultation: AdvisorConsultation | null;
  advisorDisabled: boolean;
  advisorDisabledReason: string;
  onToggleOption: (questionId: string, optionLabel: string) => PendingUserInputDraftAnswer | null;
  onOptionNoteChange: (questionId: string, optionLabel: string, value: string) => void;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onAskAdvisor: (question: string) => Promise<boolean>;
  onAdvance: (answerOverrides?: Record<string, PendingUserInputDraftAnswer>) => void;
  onPrevious: () => void;
}

export function ComposerPendingUserInputPanel({
  pendingUserInputs,
  isResponding,
  answers,
  questionIndex,
  advisorConsultation,
  advisorDisabled,
  advisorDisabledReason,
  onToggleOption,
  onOptionNoteChange,
  onCustomAnswerChange,
  onAskAdvisor,
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
      advisorConsultation={advisorConsultation}
      advisorDisabled={advisorDisabled}
      advisorDisabledReason={advisorDisabledReason}
      onToggleOption={onToggleOption}
      onOptionNoteChange={onOptionNoteChange}
      onCustomAnswerChange={onCustomAnswerChange}
      onAskAdvisor={onAskAdvisor}
      onAdvance={onAdvance}
      onPrevious={onPrevious}
    />
  );
}

/**
 * Keeps the ask-user card mounted through one shared bottom-origin disclosure
 * close when the pending request clears, and rAF-opens on appear so enter is
 * not a hard cut (option A: shared 220ms disclosure motion).
 *
 * Motion depends on `open` only — prop/array identity churn must not cancel
 * the enter rAF and leave the card at height 0.
 */
export function ComposerPendingUserInputPanelPresence({
  open,
  pendingUserInputs,
  ...panelProps
}: PendingUserInputPanelProps & { open: boolean }) {
  const [presented, setPresented] = useState<PendingUserInputPanelProps | null>(null);
  const [regionOpen, setRegionOpen] = useState(false);
  const wasOpenRef = useRef(false);
  const latestPropsRef = useRef<PendingUserInputPanelProps>({
    pendingUserInputs,
    ...panelProps,
  });
  latestPropsRef.current = { pendingUserInputs, ...panelProps };

  useEffect(() => {
    if (open) {
      if (latestPropsRef.current.pendingUserInputs[0]) {
        setPresented(latestPropsRef.current);
      }
      wasOpenRef.current = true;
      const frame = window.requestAnimationFrame(() => setRegionOpen(true));
      return () => window.cancelAnimationFrame(frame);
    }

    if (!wasOpenRef.current) {
      setRegionOpen(false);
      setPresented(null);
      return;
    }

    wasOpenRef.current = false;
    setRegionOpen(false);
    const cleanup = window.setTimeout(
      () => setPresented(null),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [open]);

  if (!presented) {
    return null;
  }

  // Live path uses current props (answers/index update); close path freezes
  // the last open snapshot so the card does not blank mid-animation.
  const live = open && pendingUserInputs[0] != null;
  const propsForPanel = live ? latestPropsRef.current : presented;

  return (
    <DisclosureRegion open={regionOpen} contentOrigin="bottom">
      <div className="pb-2" data-composer-pending-user-input-presence="true">
        <ComposerPendingUserInputPanel {...propsForPanel} />
      </div>
    </DisclosureRegion>
  );
}

function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  advisorConsultation,
  advisorDisabled,
  advisorDisabledReason,
  onToggleOption,
  onOptionNoteChange,
  onCustomAnswerChange,
  onAskAdvisor,
  onAdvance,
  onPrevious,
}: {
  prompt: PendingUserInput;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  advisorConsultation: AdvisorConsultation | null;
  advisorDisabled: boolean;
  advisorDisabledReason: string;
  onToggleOption: (questionId: string, optionLabel: string) => PendingUserInputDraftAnswer | null;
  onOptionNoteChange: (questionId: string, optionLabel: string, value: string) => void;
  onCustomAnswerChange: (questionId: string, value: string) => void;
  onAskAdvisor: (question: string) => Promise<boolean>;
  onAdvance: (answerOverrides?: Record<string, PendingUserInputDraftAnswer>) => void;
  onPrevious: () => void;
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const selectedOptionLabelSet = new Set(progress.selectedOptionLabels);
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const noteInputRef = useRef<HTMLInputElement | null>(null);
  const selectedOptionInputRef = useRef<HTMLInputElement | null>(null);
  const onAdvanceRef = useRef(onAdvance);
  const appliedAdvisorThreadIdsRef = useRef<Set<string>>(new Set());
  const [activeNoteTarget, setActiveNoteTarget] = useState<{
    questionId: string;
    optionLabel: string;
  } | null>(null);
  const [advisorRequest, setAdvisorRequest] = useState<{
    questionId: string;
    question: string;
    contextFingerprint: string;
    starting: boolean;
  } | null>(null);
  const [advisorError, setAdvisorError] = useState<string | null>(null);

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

  const noteTargetOpen =
    activeQuestion !== null &&
    activeNoteTarget?.questionId === activeQuestion.id &&
    selectedOptionLabelSet.has(activeNoteTarget.optionLabel);

  useEffect(() => {
    if (!noteTargetOpen) return;
    const frame = window.requestAnimationFrame(() => noteInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeNoteTarget, noteTargetOpen]);

  const closeActiveNote = () => {
    setActiveNoteTarget(null);
    window.requestAnimationFrame(() => selectedOptionInputRef.current?.focus());
  };

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

  const matchingAdvisorConsultation =
    advisorConsultation &&
    activeQuestion &&
    ((advisorRequest?.questionId === activeQuestion.id &&
      advisorRequest.question === advisorConsultation.question) ||
      (!advisorRequest &&
        isPendingUserInputAdvisorQuestionFor(
          advisorConsultation.question,
          activeQuestion.question,
        )))
      ? advisorConsultation
      : null;
  const advisorRecommendation = parsePendingUserInputAdvisorRecommendation(
    matchingAdvisorConsultation?.answer,
    activeQuestion?.options.map((option) => option.label) ?? [],
  );
  const applyResolvedAdvisorRecommendation = useEffectEvent(() => {
    if (
      !activeQuestion ||
      !advisorRequest ||
      !matchingAdvisorConsultation ||
      matchingAdvisorConsultation.status !== "complete" ||
      !advisorRecommendation ||
      appliedAdvisorThreadIdsRef.current.has(matchingAdvisorConsultation.threadId)
    ) {
      return;
    }
    appliedAdvisorThreadIdsRef.current.add(matchingAdvisorConsultation.threadId);
    const currentDraft = answers[activeQuestion.id];
    if (
      pendingUserInputAdvisorContextFingerprint(currentDraft) !== advisorRequest.contextFingerprint
    ) {
      return;
    }
    if (!(currentDraft?.selectedOptionLabels ?? []).includes(advisorRecommendation.optionLabel)) {
      onToggleOption(activeQuestion.id, advisorRecommendation.optionLabel);
    }
  });

  useEffect(() => {
    applyResolvedAdvisorRecommendation();
  }, [
    advisorRecommendation?.optionLabel,
    matchingAdvisorConsultation?.status,
    matchingAdvisorConsultation?.threadId,
  ]);

  useEffect(() => {
    if (!activeQuestion || isResponding) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const isOptionInput =
        target instanceof HTMLInputElement &&
        (target.type === "radio" || target.type === "checkbox");
      const isTextInput =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && !isOptionInput);
      if (isTextInput) return;
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        const selectedOptionLabel = progress.selectedOptionLabels.at(-1);
        if (!selectedOptionLabel) return;
        const shortcutTarget =
          target === document.body || isOptionInput || target === document.documentElement;
        if (!shortcutTarget) return;
        event.preventDefault();
        if (autoAdvanceTimerRef.current !== null) {
          window.clearTimeout(autoAdvanceTimerRef.current);
          autoAdvanceTimerRef.current = null;
        }
        setActiveNoteTarget({
          questionId: activeQuestion.id,
          optionLabel: selectedOptionLabel,
        });
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
  }, [activeQuestion, isResponding, progress.selectedOptionLabels]);

  if (!activeQuestion) return null;

  const questionCount = prompt.questions.length;
  const canGoBack = progress.questionIndex > 0 && !isResponding;
  const canContinue = progress.canAdvance && !isResponding;
  const advisorBusy =
    (advisorRequest?.questionId === activeQuestion.id && advisorRequest.starting) ||
    matchingAdvisorConsultation?.status === "running";
  const advisorUnavailable =
    activeQuestion.multiSelect || activeQuestion.options.length === 0 || advisorDisabled;
  const advisorButtonTitle = activeQuestion.multiSelect
    ? "Advisor choice is available for single-choice questions"
    : advisorDisabledReason;
  const advisorFailure =
    advisorError ??
    (matchingAdvisorConsultation?.status === "error"
      ? (matchingAdvisorConsultation.error ?? "Advisor could not choose an option.")
      : matchingAdvisorConsultation?.status === "stopped"
        ? "Advisor stopped before choosing an option."
        : matchingAdvisorConsultation?.status === "complete" && !advisorRecommendation
          ? "Advisor did not return one of the available options."
          : null);
  const advisorRecommendationSelected = advisorRecommendation
    ? selectedOptionLabelSet.has(advisorRecommendation.optionLabel)
    : false;
  const activeQuestionHasOpenNote = noteTargetOpen;

  const startAdvisorChoice = async () => {
    if (advisorUnavailable || advisorBusy) return;
    const question = buildPendingUserInputAdvisorQuestion(activeQuestion, progress.activeDraft);
    setAdvisorError(null);
    setAdvisorRequest({
      questionId: activeQuestion.id,
      question,
      contextFingerprint: pendingUserInputAdvisorContextFingerprint(progress.activeDraft),
      starting: true,
    });
    const started = await onAskAdvisor(question).catch(() => false);
    setAdvisorRequest((current) =>
      current?.question === question ? { ...current, starting: false } : current,
    );
    if (!started) {
      setAdvisorError("Advisor could not start. Try again.");
    }
  };

  return (
    <section
      data-testid="composer-pending-user-input-panel"
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
            {activeQuestion.options.length > 0 ? (
              <Button
                type="button"
                variant="chrome-outline"
                size="sm"
                disabled={advisorUnavailable || advisorBusy || isResponding}
                title={advisorButtonTitle}
                aria-label={advisorBusy ? "Advisor is choosing an option" : "Let Advisor choose"}
                onClick={() => void startAdvisorChoice()}
                className="shrink-0"
              >
                {advisorBusy ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
                ) : (
                  <AdvisorIcon className="size-3.5" />
                )}
                <span className="hidden sm:inline">
                  {advisorBusy ? "Advisor choosing…" : "Let Advisor choose"}
                </span>
              </Button>
            ) : null}
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
              {activeQuestion.options.map((option, optionIndex) => {
                const selected = selectedOptionLabelSet.has(option.label);
                const advisorSelected =
                  advisorRecommendation?.optionLabel === option.label && selected;
                const noteEditing =
                  selected &&
                  activeNoteTarget?.questionId === activeQuestion.id &&
                  activeNoteTarget.optionLabel === option.label;
                const optionNote = getPendingUserInputOptionNote(progress.activeDraft, option.label);
                const noteOpen = selected && noteEditing;
                const keyboardNoteTarget =
                  progress.selectedOptionLabels.at(-1) === option.label;
                return (
                  <div
                    key={`${activeQuestion.id}:${option.label}`}
                    data-testid={`option-note-${activeQuestion.id}-${optionIndex}`}
                    data-note-open={noteOpen ? "true" : "false"}
                  >
                    <label
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
                        ref={keyboardNoteTarget ? selectedOptionInputRef : undefined}
                        checked={selected}
                        disabled={isResponding}
                        onChange={() => handleOptionSelection(activeQuestion.id, option.label)}
                        className="sr-only"
                      />
                      <span className="min-w-0 flex-1 leading-snug">
                        <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-foreground/90">
                          <span>{option.label}</span>
                          {advisorSelected ? (
                            <span className="rounded bg-success/8 px-1.5 py-0.5 text-[10px] font-medium text-success">
                              Advisor selected
                            </span>
                          ) : null}
                        </span>
                        {option.description ? (
                          <span className="mt-0.5 block text-[11.5px] text-muted-foreground/65">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {selected && !noteOpen ? (
                        <span className="hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/55 sm:flex">
                          <Kbd className="h-4 min-w-0 px-1 text-[9px]">Tab</Kbd>
                          {optionNote.trim().length > 0 ? "edit note" : "note"}
                        </span>
                      ) : null}
                    </label>
                    <DisclosureRegion open={noteOpen}>
                      <div className="relative ml-3.5 pl-6 pt-1">
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-0 h-[calc(50%+0.125rem)] w-6 rounded-bl-lg border-b border-l border-border/70"
                        />
                        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/45 px-2.5 py-2">
                          <span className="hidden shrink-0 text-[10px] font-medium text-muted-foreground sm:inline">
                            Note for {option.label}
                          </span>
                          <Input
                            nativeInput
                            ref={noteEditing ? noteInputRef : undefined}
                            value={optionNote}
                            disabled={isResponding}
                            aria-label={`Note for ${option.label}`}
                            placeholder="Add context for the agent…"
                            onChange={(event) =>
                              onOptionNoteChange(
                                activeQuestion.id,
                                option.label,
                                event.currentTarget.value,
                              )
                            }
                            onKeyDown={(event) => {
                              const shouldToggleClosed =
                                event.key === "Tab" &&
                                !event.shiftKey &&
                                !event.metaKey &&
                                !event.ctrlKey &&
                                !event.altKey;
                              if (shouldToggleClosed || event.key === "Escape") {
                                event.preventDefault();
                                closeActiveNote();
                              }
                            }}
                            className="h-7 min-h-7 flex-1 border-0 bg-transparent"
                          />
                          <span className="hidden shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/55 sm:flex">
                            <Kbd className="h-4 min-w-0 px-1 text-[9px]">Tab</Kbd>
                            to edit note
                          </span>
                        </div>
                      </div>
                    </DisclosureRegion>
                  </div>
                );
              })}
            </div>
          ) : null}

          <DisclosureRegion open={!activeQuestionHasOpenNote || progress.usingCustomAnswer}>
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
          </DisclosureRegion>

          {advisorRecommendation || advisorBusy || advisorFailure ? (
            <div
              className={cn(
                "mt-3 flex min-w-0 items-center gap-2 border-t border-border/60 pt-2.5 text-[11.5px]",
                advisorFailure ? "text-destructive" : "text-muted-foreground",
              )}
              role={advisorFailure ? "alert" : "status"}
            >
              {advisorBusy ? (
                <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
              ) : advisorFailure ? (
                <CircleQuestionIcon className="size-3.5 shrink-0" />
              ) : (
                <AdvisorIcon className="size-3.5 shrink-0 text-success" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {advisorBusy
                  ? "Advisor is comparing the available options…"
                  : advisorFailure
                    ? advisorFailure
                    : advisorRecommendation?.reason}
              </span>
              {advisorRecommendation && !advisorRecommendationSelected ? (
                <Button
                  type="button"
                  size="xs"
                  variant="chrome-outline"
                  onClick={() =>
                    onToggleOption(activeQuestion.id, advisorRecommendation.optionLabel)
                  }
                >
                  Use {advisorRecommendation.optionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

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
