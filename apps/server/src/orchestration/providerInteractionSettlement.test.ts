import { Cause } from "effect";
import { describe, expect, it } from "vitest";

import { ProviderAdapterRequestError, ProviderValidationError } from "../provider/Errors.ts";
import { classifyProviderInteractionFailure } from "./providerInteractionSettlement.ts";

describe("classifyProviderInteractionFailure", () => {
  it("marks stale approval requests uncertain so an acknowledgement cannot be invented", () => {
    const result = classifyProviderInteractionFailure(
      "approval",
      Cause.fail(
        new ProviderAdapterRequestError({
          provider: "codex",
          method: "permission.reply",
          detail: "unknown pending permission request",
        }),
      ),
    );
    expect(result).toEqual({ unknownPendingRequest: true, settlementStatus: "uncertain" });
  });

  it("allows a Claude context-window user-input failure to retry", () => {
    const result = classifyProviderInteractionFailure(
      "userInput",
      Cause.fail(
        new ProviderAdapterRequestError({
          provider: "claudeAgent",
          method: "item/tool/respondToUserInput",
          detail: "context window exceeded",
        }),
      ),
    );
    expect(result).toEqual({ unknownPendingRequest: false, settlementStatus: "retryable" });
  });

  it("treats local validation failures as retryable", () => {
    const result = classifyProviderInteractionFailure(
      "userInput",
      Cause.fail(new ProviderValidationError({ operation: "respond", issue: "bad input" })),
    );
    expect(result).toEqual({ unknownPendingRequest: false, settlementStatus: "retryable" });
  });
});
