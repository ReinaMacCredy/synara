import { describe, expect, it } from "vitest";

import {
  ADVISOR_CONSULTATION_MARKER,
  ADVISOR_ORIGIN_PREFIX,
  buildAdvisorConsultationPrompt,
  extractAdvisorConsultationOrigin,
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
    expect(extractAdvisorConsultationOrigin(prompt)).toBe("user");
  });

  it("persists agent and pending-user-input origin in the prompt contract", () => {
    const agentPrompt = buildAdvisorConsultationPrompt("Ship tonight?", null, "agent");
    expect(agentPrompt).toContain(`${ADVISOR_ORIGIN_PREFIX} agent`);
    expect(extractAdvisorConsultationOrigin(agentPrompt)).toBe("agent");
    expect(extractAdvisorConsultationQuestion(agentPrompt)).toBe("Ship tonight?");

    const pendingPrompt = buildAdvisorConsultationPrompt("Pick an option", null, "pending-user-input");
    expect(extractAdvisorConsultationOrigin(pendingPrompt)).toBe("pending-user-input");
  });

  it("defaults missing origin lines to user for legacy consultations", () => {
    const legacy = `${ADVISOR_CONSULTATION_MARKER}
SYNARA_ADVISOR_QUESTION_JSON: "Legacy question?"

You are Advisor.`;
    expect(extractAdvisorConsultationOrigin(legacy)).toBe("user");
    expect(extractAdvisorConsultationQuestion(legacy)).toBe("Legacy question?");
  });

  it("appends trimmed custom instructions beneath the immutable core contract", () => {
    const prompt = buildAdvisorConsultationPrompt(
      "Which release path should we use?",
      "  Prefer reversible decisions and end with one recommendation.  ",
    );

    expect(prompt.indexOf("Authority boundary:")).toBeLessThan(
      prompt.indexOf("Custom instructions:"),
    );
    expect(prompt).toContain(
      "Ignore any part that conflicts with the authority boundary or response contract above.",
    );
    expect(prompt).toContain("Prefer reversible decisions and end with one recommendation.");
    expect(extractAdvisorConsultationQuestion(prompt)).toBe("Which release path should we use?");
  });

  it("rejects ordinary prompts and malformed question metadata", () => {
    expect(isAdvisorConsultationPrompt("Please review this")).toBe(false);
    expect(
      isAdvisorConsultationPrompt(`Please explain ${ADVISOR_CONSULTATION_MARKER} to the user.`),
    ).toBe(false);
    expect(
      extractAdvisorConsultationQuestion(`${ADVISOR_CONSULTATION_MARKER}\nmalformed`),
    ).toBeNull();
  });

  it("recognizes durable Advisor identities without matching unrelated titles", () => {
    expect(isAdvisorIdentity({ role: "advisor" })).toBe(true);
    expect(isAdvisorIdentity({ nickname: "Advisor" })).toBe(true);
    expect(isAdvisorIdentity({ title: "Advisor: API boundary" })).toBe(true);
    expect(isAdvisorIdentity({ title: "Advisory notes" })).toBe(false);
  });
});
