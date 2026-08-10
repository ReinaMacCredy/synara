import { describe, expect, it } from "vitest";

import {
  buildPendingUserInputAdvisorQuestion,
  extractPendingUserInputAdvisorQuestion,
  isPendingUserInputAdvisorQuestion,
  isPendingUserInputAdvisorQuestionFor,
  parsePendingUserInputAdvisorRecommendation,
  pendingUserInputAdvisorContextFingerprint,
  shouldShowPendingUserInputAdvisorConsultation,
} from "./pendingUserInputAdvisor";

const question = {
  id: "scope",
  header: "Scope",
  question: "Which path should the agent use?",
  options: [
    { label: "Option A", description: "Prefer the safer default." },
    { label: "Option B", description: "Prefer the faster path." },
  ],
} as const;

describe("pending user-input Advisor contract", () => {
  it("builds a marked consultation with options and selected-option notes", () => {
    const prompt = buildPendingUserInputAdvisorQuestion(question, {
      selectedOptionLabels: ["Option A"],
      optionNotes: { "Option A": "Keep rollback simple" },
    });

    expect(isPendingUserInputAdvisorQuestion(prompt)).toBe(true);
    expect(extractPendingUserInputAdvisorQuestion(prompt)).toBe(question.question);
    expect(isPendingUserInputAdvisorQuestionFor(prompt, question.question)).toBe(true);
    expect(isPendingUserInputAdvisorQuestionFor(prompt, "A different question?")).toBe(false);
    expect(prompt).toContain("1. Option A — Prefer the safer default.");
    expect(prompt).toContain("- Option A: Keep rollback simple");
    expect(prompt).toContain("first non-empty line must be exactly one option label");
  });

  it("extracts multiline questions without leaking the internal prompt contract", () => {
    const multilineQuestion = {
      ...question,
      question: "Which path should the agent use?\nInclude the rollout constraint.",
    };
    const prompt = buildPendingUserInputAdvisorQuestion(multilineQuestion, undefined);

    expect(extractPendingUserInputAdvisorQuestion(prompt)).toBe(multilineQuestion.question);
    expect(isPendingUserInputAdvisorQuestionFor(prompt, multilineQuestion.question)).toBe(true);
  });

  it("keeps the internal Advisor card visible only while its matching question is pending", () => {
    const prompt = buildPendingUserInputAdvisorQuestion(question, undefined);

    expect(shouldShowPendingUserInputAdvisorConsultation(prompt, [question.question])).toBe(true);
    expect(shouldShowPendingUserInputAdvisorConsultation(prompt, ["A newer question?"])).toBe(
      false,
    );
    expect(shouldShowPendingUserInputAdvisorConsultation(prompt, [])).toBe(false);
    expect(shouldShowPendingUserInputAdvisorConsultation("Should we keep the adapter?", [])).toBe(
      true,
    );
  });

  it("parses an exact allowed option and its short reason", () => {
    expect(
      parsePendingUserInputAdvisorRecommendation(
        "**Option A**\nIt avoids the higher-risk path.",
        question.options.map((option) => option.label),
      ),
    ).toEqual({
      optionLabel: "Option A",
      reason: "It avoids the higher-risk path.",
    });
  });

  it("accepts a recommended option when Advisor omits its display suffix", () => {
    expect(
      parsePendingUserInputAdvisorRecommendation(
        "A simple choice\nIt is the least ambiguous test.",
        ["A simple choice (Recommended)", "A free-form answer", "Skip the test"],
      ),
    ).toEqual({
      optionLabel: "A simple choice (Recommended)",
      reason: "It is the least ambiguous test.",
    });
  });

  it("rejects answers that do not identify an allowed option", () => {
    expect(
      parsePendingUserInputAdvisorRecommendation(
        "Option C\nIt looks plausible.",
        question.options.map((option) => option.label),
      ),
    ).toBeNull();
  });

  it("changes the staleness fingerprint when the selected option note changes", () => {
    const before = pendingUserInputAdvisorContextFingerprint({
      selectedOptionLabels: ["Option A"],
      optionNotes: { "Option A": "First note" },
    });
    const after = pendingUserInputAdvisorContextFingerprint({
      selectedOptionLabels: ["Option A"],
      optionNotes: { "Option A": "Revised note" },
    });

    expect(after).not.toBe(before);
  });
});
