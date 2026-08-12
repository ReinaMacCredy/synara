// FILE: providerInteractionSettlement.ts
// Purpose: Classifies provider approval and user-input failures for durable settlement.
// Layer: Orchestration provider interaction policy

import { Cause, Option, Schema } from "effect";

import { ProviderAdapterRequestError, type ProviderServiceError } from "../provider/Errors.ts";

export type ProviderInteractionKind = "approval" | "userInput";
export type ProviderInteractionSettlementStatus = "retryable" | "uncertain";

function isUnknownPendingRequestError(
  kind: ProviderInteractionKind,
  cause: Cause.Cause<ProviderServiceError>,
): boolean {
  const error = Cause.squash(cause);
  const message = Schema.is(ProviderAdapterRequestError)(error)
    ? error.detail.toLowerCase()
    : Cause.pretty(cause).toLowerCase();
  return kind === "approval"
    ? message.includes("unknown pending approval request") ||
        message.includes("unknown pending permission request")
    : message.includes("unknown pending user-input request");
}

function isClaudeContextWindowUserInputRejection(error: ProviderServiceError): boolean {
  if (
    error._tag !== "ProviderAdapterRequestError" ||
    error.provider !== "claudeAgent" ||
    error.method !== "item/tool/respondToUserInput"
  ) {
    return false;
  }
  const detail = error.detail.toLowerCase();
  return [
    "context window",
    "context limit",
    "context length",
    "context_length_exceeded",
    "prompt is too long",
    "input_length and max_tokens",
  ].some((fragment) => detail.includes(fragment));
}

export function classifyProviderInteractionFailure(
  kind: ProviderInteractionKind,
  cause: Cause.Cause<ProviderServiceError>,
): {
  readonly unknownPendingRequest: boolean;
  readonly settlementStatus: ProviderInteractionSettlementStatus;
} {
  const unknownPendingRequest = isUnknownPendingRequestError(kind, cause);
  const settlementStatus = Option.match(Cause.findErrorOption(cause), {
    onNone: () => "uncertain" as const,
    onSome: (error) => {
      if (
        (error._tag === "ProviderAdapterRequestError" &&
          error.method === "permission.reply.acknowledge") ||
        isClaudeContextWindowUserInputRejection(error)
      ) {
        return "retryable" as const;
      }
      return unknownPendingRequest ||
        error._tag === "ProviderAdapterRequestError" ||
        error._tag === "ProviderAdapterProcessError"
        ? ("uncertain" as const)
        : ("retryable" as const);
    },
  });
  return { unknownPendingRequest, settlementStatus };
}
