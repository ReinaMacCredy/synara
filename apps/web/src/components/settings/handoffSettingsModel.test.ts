import { describe, expect, it } from "vitest";

import { resolveHandoffSettingsModel } from "./handoffSettingsModel";

describe("resolveHandoffSettingsModel", () => {
  it("preserves the provider-specific model when it remains available", () => {
    expect(
      resolveHandoffSettingsModel({
        provider: "codex",
        rememberedModel: "gpt-5.6-luna",
        options: [{ slug: "gpt-5.5" }, { slug: "gpt-5.6-luna" }],
      }),
    ).toBe("gpt-5.6-luna");
  });

  it("falls back to the provider default instead of carrying an incompatible slug", () => {
    expect(
      resolveHandoffSettingsModel({
        provider: "claudeAgent",
        rememberedModel: "gpt-5.6-luna",
        options: [{ slug: "claude-opus-4-8" }, { slug: "claude-sonnet-5" }],
      }),
    ).toBe("claude-sonnet-5");
  });
});
