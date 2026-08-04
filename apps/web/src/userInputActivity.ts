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
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map<UserInputQuestion["options"][number] | null>((option) => {
          if (!option || typeof option !== "object") return null;
          const optionRecord = option as Record<string, unknown>;
          if (
            typeof optionRecord.label !== "string" ||
            typeof optionRecord.description !== "string"
          ) {
            return null;
          }
          return {
            label: optionRecord.label,
            description: optionRecord.description,
          };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      return {
        id: question.id,
        header: question.header,
        question: question.question,
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
