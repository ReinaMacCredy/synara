import { RlmAdmissionMode, type RlmAdmissionReceipt, type RunPolicy } from "@veylen/contracts";

export interface RlmAdmissionInput {
  readonly episodeId: RlmAdmissionReceipt["episodeId"];
  readonly requestedMode: typeof RlmAdmissionMode.Type;
  readonly estimatedContextPercent: number;
  readonly estimatedInputTokens: number;
  readonly independentEvidenceBranches: number;
  readonly policyId: RunPolicy["id"];
  readonly createdAt: string;
}

export const RLM_AUTO_THRESHOLDS = {
  contextPercent: 65,
  inputTokens: 24_000,
  evidenceBranches: 4,
} as const;

export function decideRlmAdmission(input: RlmAdmissionInput): RlmAdmissionReceipt {
  const reasons: string[] = [];
  if (input.estimatedContextPercent >= RLM_AUTO_THRESHOLDS.contextPercent) {
    reasons.push(
      `Estimated context ${input.estimatedContextPercent}% reached ${RLM_AUTO_THRESHOLDS.contextPercent}%.`,
    );
  }
  if (input.estimatedInputTokens >= RLM_AUTO_THRESHOLDS.inputTokens) {
    reasons.push(
      `Estimated input ${input.estimatedInputTokens} tokens reached ${RLM_AUTO_THRESHOLDS.inputTokens}.`,
    );
  }
  if (input.independentEvidenceBranches >= RLM_AUTO_THRESHOLDS.evidenceBranches) {
    reasons.push(
      `${input.independentEvidenceBranches} independent evidence branches reached ${RLM_AUTO_THRESHOLDS.evidenceBranches}.`,
    );
  }
  const selectedMode =
    input.requestedMode === "direct"
      ? "direct"
      : input.requestedMode === "recursive"
        ? "recursive"
        : reasons.length > 0
          ? "recursive"
          : "direct";
  if (input.requestedMode !== "auto") {
    reasons.unshift(`Execution mode was explicitly forced to ${selectedMode}.`);
  } else if (reasons.length === 0) {
    reasons.push("All recursive admission signals remained below threshold.");
  }
  return {
    episodeId: input.episodeId,
    requestedMode: input.requestedMode,
    selectedMode,
    estimatedContextPercent: input.estimatedContextPercent,
    estimatedInputTokens: input.estimatedInputTokens,
    independentEvidenceBranches: input.independentEvidenceBranches,
    reasons,
    admittedByPolicyId: input.policyId,
    createdAt: input.createdAt,
  };
}
