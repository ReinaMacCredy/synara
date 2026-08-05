import { describe, expect, it } from "vitest";

import { parseUserInputQuestions } from "./userInputActivity";

describe("parseUserInputQuestions", () => {
  it("accepts options without description by falling back to the label", () => {
    const parsed = parseUserInputQuestions({
      questions: [
        {
          id: "q1",
          header: "Question",
          question: "What next?",
          options: [{ label: "Ship it" }, { label: "Wait", description: "Hold for review" }],
        },
      ],
    });

    expect(parsed).toEqual([
      {
        id: "q1",
        header: "Question",
        question: "What next?",
        options: [
          { label: "Ship it", description: "Ship it" },
          { label: "Wait", description: "Hold for review" },
        ],
      },
    ]);
  });

  it("defaults a missing header so the panel can still open", () => {
    const parsed = parseUserInputQuestions({
      questions: [
        {
          id: "q2",
          question: "Continue?",
          options: [{ label: "Yes" }],
        },
      ],
    });

    expect(parsed?.[0]).toMatchObject({
      id: "q2",
      header: "Question",
      question: "Continue?",
      options: [{ label: "Yes", description: "Yes" }],
    });
  });

  it("returns null when no questions can be rendered", () => {
    expect(parseUserInputQuestions({ questions: [{ id: "x" }] })).toBeNull();
    expect(parseUserInputQuestions(null)).toBeNull();
  });
});
