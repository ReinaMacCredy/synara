import { describe, expect, it } from "vitest";

import { pluginInstallStepIdempotencyKey } from "./wsRpc";

describe("pluginInstallStepIdempotencyKey", () => {
  it.each([
    "plugin-subscription",
    "plugin-subscription-revoke",
    "plugin-reset-circuit",
    "plugin-enable",
    "plugin-subscription-enable",
  ] as const)("binds the %s receipt to its expected revision", (step) => {
    const base = {
      step,
      pluginId: "plugin.example",
      packageIdentity: "sha256:package",
      ...(step.includes("subscription") ? { subscriptionId: "subscription.example" } : {}),
    };

    expect(
      pluginInstallStepIdempotencyKey({ ...base, expectedRevision: 4 }),
    ).not.toBe(pluginInstallStepIdempotencyKey({ ...base, expectedRevision: 5 }));
  });
});
