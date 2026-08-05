// FILE: ComposerPendingUserInputPanel.browser.tsx
// Purpose: Browser regression coverage for the inline request_user_input question flow.
// Layer: Chat composer UI browser test

import { ApprovalRequestId, ThreadId, type UserInputQuestion } from "@synara/contracts";
import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { type PendingUserInput } from "../../session-logic";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  setPendingUserInputOptionNote,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { buildPendingUserInputAdvisorQuestion } from "../../pendingUserInputAdvisor";
import type { AdvisorConsultation } from "~/lib/advisorConsultation";
import { DISCLOSURE_CLEANUP_BUFFER_MS } from "~/lib/disclosureMotion";
import {
  ComposerPendingUserInputPanel,
  ComposerPendingUserInputPanelPresence,
  PENDING_USER_INPUT_EXIT_COLLAPSE_MS,
  PENDING_USER_INPUT_EXIT_RECEIPT_MS,
} from "./ComposerPendingUserInputPanel";

const QUESTIONS: UserInputQuestion[] = [
  {
    id: "scope",
    header: "Scope",
    question: "How focused should the first release be?",
    options: [
      { label: "A focused starter set", description: "Keep the first release narrow." },
      { label: "A broader collection", description: "Cover more use cases immediately." },
    ],
  },
  {
    id: "checks",
    header: "Checks",
    question: "Which checks should block publishing?",
    multiSelect: true,
    options: [
      { label: "Type safety", description: "Require the type check to pass." },
      { label: "Accessibility", description: "Require accessibility review." },
    ],
  },
  {
    id: "preserve",
    header: "Preserve",
    question: "Anything the agent should preserve?",
    options: [],
  },
];

const PROMPT: PendingUserInput = {
  requestId: ApprovalRequestId.makeUnsafe("user-input-test-1"),
  lifecycleGeneration: "generation-test-1",
  createdAt: "2026-08-04T01:00:00.000Z",
  questions: QUESTIONS,
};

function QuestionFlow({
  onSubmit,
}: {
  onSubmit: (answers: Record<string, string | string[]>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);

  return (
    <ComposerPendingUserInputPanel
      pendingUserInputs={[PROMPT]}
      isResponding={false}
      answers={answers}
      questionIndex={questionIndex}
      advisorConsultation={null}
      advisorDisabled
      advisorDisabledReason="Advisor is unavailable in this flow"
      onToggleOption={(questionId, optionLabel) => {
        const question = QUESTIONS.find((entry) => entry.id === questionId);
        if (!question) return null;
        const next = togglePendingUserInputOptionSelection(
          question,
          answers[questionId],
          optionLabel,
        );
        setAnswers((current) => ({ ...current, [questionId]: next }));
        return next;
      }}
      onOptionNoteChange={(questionId, optionLabel, value) => {
        setAnswers((current) => ({
          ...current,
          [questionId]: setPendingUserInputOptionNote(
            current[questionId],
            optionLabel,
            value,
          ),
        }));
      }}
      onCustomAnswerChange={(questionId, value) => {
        setAnswers((current) => ({
          ...current,
          [questionId]: setPendingUserInputCustomAnswer(current[questionId], value),
        }));
      }}
      onAskAdvisor={async () => false}
      onAdvance={(answerOverrides) => {
        const nextAnswers = { ...answers, ...answerOverrides };
        setAnswers(nextAnswers);
        if (questionIndex < QUESTIONS.length - 1) {
          setQuestionIndex((current) => current + 1);
          return;
        }
        const resolved = buildPendingUserInputAnswers(QUESTIONS, nextAnswers);
        if (resolved) onSubmit(resolved);
      }}
      onPrevious={() => setQuestionIndex((current) => Math.max(0, current - 1))}
    />
  );
}

function AdvisorQuestionFlow({
  onSubmit,
}: {
  onSubmit: (answers: Record<string, string | string[]>) => void;
}) {
  const question = QUESTIONS[0]!;
  const prompt: PendingUserInput = { ...PROMPT, questions: [question] };
  const [answers, setAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [advisorConsultation, setAdvisorConsultation] = useState<AdvisorConsultation | null>(null);

  return (
    <ComposerPendingUserInputPanel
      pendingUserInputs={[prompt]}
      isResponding={false}
      answers={answers}
      questionIndex={0}
      advisorConsultation={advisorConsultation}
      advisorDisabled={advisorConsultation?.status === "running"}
      advisorDisabledReason="Advisor is already choosing"
      onToggleOption={(questionId, optionLabel) => {
        const next = togglePendingUserInputOptionSelection(
          question,
          answers[questionId],
          optionLabel,
        );
        setAnswers((current) => ({ ...current, [questionId]: next }));
        return next;
      }}
      onOptionNoteChange={(questionId, optionLabel, value) => {
        setAnswers((current) => ({
          ...current,
          [questionId]: setPendingUserInputOptionNote(
            current[questionId],
            optionLabel,
            value,
          ),
        }));
      }}
      onCustomAnswerChange={(questionId, value) => {
        setAnswers((current) => ({
          ...current,
          [questionId]: setPendingUserInputCustomAnswer(current[questionId], value),
        }));
      }}
      onAskAdvisor={async (advisorQuestion) => {
        const threadId = ThreadId.makeUnsafe("advisor-user-input-test");
        setAdvisorConsultation({
          threadId,
          question: advisorQuestion,
          answer: null,
          answerStreaming: false,
          error: null,
          status: "running",
          origin: "user",
        });
        window.setTimeout(() => {
          setAdvisorConsultation({
            threadId,
            question: advisorQuestion,
            answer: "A focused starter set\nIt avoids the higher-risk path.",
            answerStreaming: false,
            error: null,
            status: "complete",
            origin: "user",
          });
        }, 50);
        return true;
      }}
      onAdvance={() => {
        const resolved = buildPendingUserInputAnswers([question], answers);
        if (resolved) onSubmit(resolved);
      }}
      onPrevious={() => undefined}
    />
  );
}

describe("ComposerPendingUserInputPanel", () => {
  it("runs the supplied single-select, multi-select, and custom-answer flow", async () => {
    const onSubmit = vi.fn();
    const screen = await render(<QuestionFlow onSubmit={onSubmit} />);

    try {
      await expect
        .element(page.getByRole("heading", { name: "How focused should the first release be?" }))
        .toBeInTheDocument();
      await expect.element(page.getByText("1/3")).toBeInTheDocument();

      await page.getByRole("radio", { name: "A focused starter set" }).click();
      await expect
        .element(page.getByRole("heading", { name: "Which checks should block publishing?" }))
        .toBeInTheDocument();

      await page.getByRole("checkbox", { name: "Type safety" }).click();
      await page.getByRole("button", { name: "Next question" }).click();
      await expect
        .element(page.getByRole("heading", { name: "Anything the agent should preserve?" }))
        .toBeInTheDocument();

      await page
        .getByRole("textbox", { name: "Custom answer for Anything the agent should preserve?" })
        .fill("Keep the public API stable");
      await page.getByRole("button", { name: "Submit response" }).click();

      expect(onSubmit).toHaveBeenCalledWith({
        scope: "A focused starter set",
        checks: ["Type safety"],
        preserve: "Keep the public API stable",
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows a submitting state and disables question controls", async () => {
    const screen = await render(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[PROMPT]}
        isResponding
        answers={{ scope: { selectedOptionLabels: ["A focused starter set"] } }}
        questionIndex={0}
        advisorConsultation={null}
        advisorDisabled
        advisorDisabledReason="Advisor is unavailable while submitting"
        onToggleOption={() => null}
        onOptionNoteChange={() => undefined}
        onCustomAnswerChange={() => undefined}
        onAskAdvisor={async () => false}
        onAdvance={() => undefined}
        onPrevious={() => undefined}
      />,
    );

    try {
      await expect.element(page.getByRole("region")).toHaveAttribute("aria-busy", "true");
      await expect
        .element(page.getByRole("radio", { name: "A focused starter set" }))
        .toBeDisabled();
      await expect.element(page.getByRole("button", { name: "Next question" })).toBeDisabled();
    } finally {
      await screen.unmount();
    }
  });

  it("restores the visible state of an in-flight Advisor choice", async () => {
    const question = QUESTIONS[0]!;
    const screen = await render(
      <ComposerPendingUserInputPanel
        pendingUserInputs={[{ ...PROMPT, questions: [question] }]}
        isResponding={false}
        answers={{ scope: { selectedOptionLabels: ["A focused starter set"] } }}
        questionIndex={0}
        advisorConsultation={{
          threadId: ThreadId.makeUnsafe("advisor-user-input-restored"),
          question: buildPendingUserInputAdvisorQuestion(question, {
            selectedOptionLabels: ["A focused starter set"],
          }),
          answer: null,
          answerStreaming: false,
          error: null,
          status: "running",
          origin: "user",
        }}
        advisorDisabled
        advisorDisabledReason="Advisor is already choosing"
        onToggleOption={() => null}
        onOptionNoteChange={() => undefined}
        onCustomAnswerChange={() => undefined}
        onAskAdvisor={async () => false}
        onAdvance={() => undefined}
        onPrevious={() => undefined}
      />,
    );

    try {
      await expect
        .element(page.getByRole("button", { name: "Advisor is choosing an option" }))
        .toBeDisabled();
      await expect
        .element(page.getByText("Advisor is comparing the available options…"))
        .toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("opens an attached note with Tab and keeps a late Advisor result user-controlled", async () => {
    const onSubmit = vi.fn();
    const screen = await render(<AdvisorQuestionFlow onSubmit={onSubmit} />);

    try {
      const optionARadio = page.getByRole("radio", { name: "A focused starter set" });
      await optionARadio.click();
      await userEvent.keyboard("{Tab}");
      const noteInput = page.getByRole("textbox", { name: "Note for A focused starter set" });
      const noteRegion = page.getByTestId("option-note-scope-0");
      await expect.element(noteInput).toHaveFocus();
      await expect.element(noteRegion).toHaveAttribute("data-note-open", "true");
      await noteInput.fill("Keep rollback simple");
      await userEvent.keyboard("{Tab}");
      await expect.element(noteRegion).toHaveAttribute("data-note-open", "false");
      await expect.element(optionARadio).toHaveFocus();
      await userEvent.keyboard("{Tab}");
      await expect.element(noteInput).toHaveFocus();
      await expect.element(noteRegion).toHaveAttribute("data-note-open", "true");
      await expect.element(noteInput).toHaveValue("Keep rollback simple");

      await page.getByRole("button", { name: "Let Advisor choose" }).click();
      await page.getByRole("radio", { name: "A broader collection" }).click();

      await expect
        .element(page.getByRole("button", { name: "Use A focused starter set" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("radio", { name: "A broader collection" }))
        .toBeChecked();
      expect(onSubmit).not.toHaveBeenCalled();

      await page.getByRole("button", { name: "Use A focused starter set" }).click();
      await expect.element(noteInput).toHaveValue("Keep rollback simple");
      await page.getByRole("button", { name: "Submit response" }).click();

      expect(onSubmit).toHaveBeenCalledWith({
        scope: "A focused starter set\nNote for agent: Keep rollback simple",
      });
    } finally {
      await screen.unmount();
    }
  });

  it("morphs to an Answer-sent pill then ease-in collapses the slot", async () => {
    const panelProps = {
      pendingUserInputs: [PROMPT],
      isResponding: false,
      answers: {} as Record<string, PendingUserInputDraftAnswer>,
      questionIndex: 0,
      advisorConsultation: null,
      advisorDisabled: true,
      advisorDisabledReason: "Advisor is unavailable in this flow",
      onToggleOption: () => null,
      onOptionNoteChange: () => undefined,
      onCustomAnswerChange: () => undefined,
      onAskAdvisor: async () => false,
      onAdvance: () => undefined,
      onPrevious: () => undefined,
    };

    const renderPresence = (open: boolean) => (
      <ComposerPendingUserInputPanelPresence
        {...panelProps}
        open={open}
        pendingUserInputs={open ? [PROMPT] : []}
      />
    );

    const mounted = await render(renderPresence(true));

    try {
      await expect
        .poll(() => mounted.container.querySelector('[data-testid="composer-pending-user-input-panel"]'))
        .not.toBeNull();
      await expect
        .element(page.getByRole("heading", { name: "How focused should the first release be?" }))
        .toBeVisible();

      await mounted.rerender(renderPresence(false));

      // Phase 1: receipt morph while the card is still mounted under the shell.
      await expect
        .poll(
          () =>
            mounted.container.querySelector(
              '[data-composer-pending-user-input-presence="true"][data-exit-receipt="true"]',
            ),
        )
        .not.toBeNull();
      await expect.element(page.getByRole("status")).toHaveTextContent("Answer sent");
      expect(
        mounted.container.querySelector('[data-testid="composer-pending-user-input-panel"]'),
      ).not.toBeNull();
      expect(
        mounted.container
          .querySelector("[data-composer-pending-user-input-presence='true']")
          ?.getAttribute("data-open"),
      ).toBe("true");

      // After receipt, shell starts the ease-in collapse.
      await expect
        .poll(
          () =>
            mounted.container
              .querySelector("[data-composer-pending-user-input-presence='true']")
              ?.getAttribute("data-open"),
          { timeout: PENDING_USER_INPUT_EXIT_RECEIPT_MS + 120 },
        )
        .toBe("false");

      await new Promise((resolve) =>
        window.setTimeout(
          resolve,
          PENDING_USER_INPUT_EXIT_COLLAPSE_MS + DISCLOSURE_CLEANUP_BUFFER_MS + 40,
        ),
      );
      expect(
        mounted.container.querySelector('[data-testid="composer-pending-user-input-panel"]'),
      ).toBeNull();
      expect(
        mounted.container.querySelector("[data-composer-pending-user-input-presence='true']"),
      ).toBeNull();
    } finally {
      await mounted.unmount();
    }
  });
});
