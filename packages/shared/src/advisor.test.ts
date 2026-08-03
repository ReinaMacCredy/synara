import { describe, expect, it } from "vitest";

import {
  ADVISOR_CONSULTATION_MARKER,
  buildAdvisorConsultationPrompt,
  extractAdvisorConsultationQuestion,
  isAdvisorConsultationPrompt,
  isAdvisorIdentity,
} from "./advisor";

describe("Advisor consultation contract", () => {
  it("round-trips questions without confusing prompt-shaped user text for metadata", () => {
    const question = 'Should we keep the line "SYNARA_ADVISOR_QUESTION_JSON:" in the parser?';
    const prompt = buildAdvisorConsultationPrompt(question);

    expect(prompt).toContain(ADVISOR_CONSULTATION_MARKER);
    expect(prompt).toContain("Advice only");
    expect(extractAdvisorConsultationQuestion(prompt)).toBe(question);
  });

  it("rejects ordinary prompts and malformed question metadata", () => {
    expect(isAdvisorConsultationPrompt("Please review this")).toBe(false);
    expect(
      isAdvisorConsultationPrompt(`Please explain ${ADVISOR_CONSULTATION_MARKER} to the user.`),
    ).toBe(false);
    expect(extractAdvisorConsultationQuestion(`${ADVISOR_CONSULTATION_MARKER}\nmalformed`)).toBeNull();
  });

  it("recognizes durable Advisor identities without matching unrelated titles", () => {
    expect(isAdvisorIdentity({ role: "advisor" })).toBe(true);
    expect(isAdvisorIdentity({ nickname: "Advisor" })).toBe(true);
    expect(isAdvisorIdentity({ title: "Advisor: API boundary" })).toBe(true);
    expect(isAdvisorIdentity({ title: "Advisory notes" })).toBe(false);
  });
});
