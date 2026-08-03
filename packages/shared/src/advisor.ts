// FILE: advisor.ts
// Purpose: Shared identity and prompt contract for bounded Advisor consultations.

export const ADVISOR_CONSULTATION_MARKER = "SYNARA_ADVISOR_CONSULTATION_V1";
export const ADVISOR_QUESTION_PREFIX = "SYNARA_ADVISOR_QUESTION_JSON:";
export const ADVISOR_NICKNAME = "Advisor";
export const ADVISOR_ROLE = "advisor";

export function buildAdvisorConsultationPrompt(question: string): string {
  const normalizedQuestion = question.trim();
  return `${ADVISOR_CONSULTATION_MARKER}
${ADVISOR_QUESTION_PREFIX} ${JSON.stringify(normalizedQuestion)}

You are Advisor. Give a second opinion on the question above using the supplied task context.

Authority boundary:
- Advice only. Do not edit files, run commands, change settings, send external messages, request approvals, or take ownership of the task.
- Do not create or delegate to other agents.
- Inspect existing context only and answer once.

Response contract:
- Lead with the recommended answer.
- Explain the decisive tradeoffs and risks.
- State material uncertainty or missing evidence.
- Keep the response focused enough for the working agent or user to apply deliberately.`;
}

export function isAdvisorConsultationPrompt(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return value.split(/\r?\n/, 1)[0]?.trim() === ADVISOR_CONSULTATION_MARKER;
}

export function extractAdvisorConsultationQuestion(
  value: string | null | undefined,
): string | null {
  if (!isAdvisorConsultationPrompt(value)) {
    return null;
  }
  const questionLine = value
    ?.split(/\r?\n/)
    .find((line) => line.startsWith(`${ADVISOR_QUESTION_PREFIX} `));
  if (!questionLine) {
    return null;
  }
  const encoded = questionLine.slice(ADVISOR_QUESTION_PREFIX.length).trim();
  try {
    const decoded: unknown = JSON.parse(encoded);
    return typeof decoded === "string" && decoded.trim().length > 0 ? decoded.trim() : null;
  } catch {
    return null;
  }
}

export function isAdvisorIdentity(input: {
  nickname?: string | null | undefined;
  role?: string | null | undefined;
  title?: string | null | undefined;
}): boolean {
  const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";
  const nickname = normalize(input.nickname);
  const role = normalize(input.role);
  const title = normalize(input.title);
  return (
    nickname === ADVISOR_ROLE ||
    role === ADVISOR_ROLE ||
    title === ADVISOR_ROLE ||
    title.startsWith(`${ADVISOR_ROLE}:`) ||
    title.startsWith(`${ADVISOR_ROLE} [`)
  );
}
