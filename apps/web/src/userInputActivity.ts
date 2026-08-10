import type { ProviderUserInputAnswers, UserInputQuestion } from "@synara/contracts";

export function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map<UserInputQuestion | null>((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as Record<string, unknown>;
      const id = typeof question.id === "string" ? question.id.trim() : "";
      // Providers sometimes omit header; keep the prompt renderable.
      const header =
        typeof question.header === "string" && question.header.trim().length > 0
          ? question.header.trim()
          : "Question";
      const prompt = typeof question.question === "string" ? question.question.trim() : "";
      if (!id || !prompt) {
        return null;
      }
      const rawOptions = Array.isArray(question.options) ? question.options : [];
      const options = rawOptions
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          const label = typeof optionRecord.label === "string" ? optionRecord.label.trim() : "";
          if (!label) {
            return null;
          }
          // Match server leniency: missing description falls back to the label
          // so a partial payload still surfaces the composer panel immediately.
          const description =
            typeof optionRecord.description === "string" &&
            optionRecord.description.trim().length > 0
              ? optionRecord.description.trim()
              : label;
          return { label, description };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      return {
        id,
        header,
        question: prompt,
        options,
        ...(question.multiSelect === true ? { multiSelect: true } : {}),
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function parseUserInputAnswers(
  payload: Record<string, unknown> | null,
): ProviderUserInputAnswers | null {
  const answers = payload?.answers;
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return null;
  }

  const parsed: Record<string, string | string[] | null> = {};
  for (const [questionId, answer] of Object.entries(answers)) {
    if (answer === null || typeof answer === "string") {
      parsed[questionId] = answer;
      continue;
    }
    if (Array.isArray(answer) && answer.every((value) => typeof value === "string")) {
      parsed[questionId] = answer;
    }
  }
  return parsed;
}
