// FILE: ComposerPendingUserInputPanel.browser.tsx
// Purpose: Browser regression coverage for the inline request_user_input question flow.
// Layer: Chat composer UI browser test

import { ApprovalRequestId, type UserInputQuestion } from "@synara/contracts";
import { useState } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { type PendingUserInput } from "../../session-logic";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { ComposerPendingUserInputPanel } from "./ComposerPendingUserInputPanel";

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

function QuestionFlow({ onSubmit }: { onSubmit: (answers: Record<string, string | string[]>) => void }) {
  const [answers, setAnswers] = useState<Record<string, PendingUserInputDraftAnswer>>({});
  const [questionIndex, setQuestionIndex] = useState(0);

  return (
    <ComposerPendingUserInputPanel
      pendingUserInputs={[PROMPT]}
      isResponding={false}
      answers={answers}
      questionIndex={questionIndex}
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
      onCustomAnswerChange={(questionId, value) => {
        setAnswers((current) => ({
          ...current,
          [questionId]: setPendingUserInputCustomAnswer(current[questionId], value),
        }));
      }}
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

describe("ComposerPendingUserInputPanel", () => {
  it("runs the supplied single-select, multi-select, and custom-answer flow", async () => {
    const onSubmit = vi.fn();
    const screen = await render(<QuestionFlow onSubmit={onSubmit} />);

    try {
      await expect
        .element(page.getByRole("heading", { name: "How focused should the first release be?" }))
        .toBeInTheDocument();
      await expect.element(page.getByText("1/3")).toBeInTheDocument();

      await page.getByText("A focused starter set").click();
      await expect
        .element(page.getByRole("heading", { name: "Which checks should block publishing?" }))
        .toBeInTheDocument();

      await page.getByText("Type safety").click();
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
        onToggleOption={() => null}
        onCustomAnswerChange={() => undefined}
        onAdvance={() => undefined}
        onPrevious={() => undefined}
      />,
    );

    try {
      await expect.element(page.getByRole("region")).toHaveAttribute("aria-busy", "true");
      await expect.element(page.getByRole("radio", { name: "A focused starter set" })).toBeDisabled();
      await expect.element(page.getByRole("button", { name: "Next question" })).toBeDisabled();
    } finally {
      await screen.unmount();
    }
  });
});
