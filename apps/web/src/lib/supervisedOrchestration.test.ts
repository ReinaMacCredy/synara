import { describe, expect, it } from "vitest";

import { resolveSupervisedBoundModelSelection } from "./supervisedOrchestration";

describe("resolveSupervisedBoundModelSelection", () => {
  it("uses the immutable Codex profile model and effort instead of hidden composer state", () => {
    expect(
      resolveSupervisedBoundModelSelection({
        fallback: { provider: "codex", model: "gpt-5.6-luna" },
        runtime: {
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoningEffort: "medium",
          sandboxMode: "danger-full-access",
          approvalPolicy: "never",
          developerInstructions: "Lead the project.",
        },
      }),
    ).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      options: { reasoningEffort: "medium" },
    });
  });

  it("preserves the ordinary composer selection when no Supervised snapshot is bound", () => {
    const fallback = {
      provider: "claudeAgent" as const,
      model: "claude-opus-4-6",
      options: { effort: "high" as const },
    };
    expect(resolveSupervisedBoundModelSelection({ fallback, runtime: null })).toBe(fallback);
  });

  it("omits Codex effort options when the bound profile has no effort", () => {
    expect(
      resolveSupervisedBoundModelSelection({
        fallback: { provider: "codex", model: "gpt-5.6-luna" },
        runtime: {
          provider: "codex",
          model: "gpt-5.6-sol",
          reasoningEffort: null,
          sandboxMode: "workspace-write",
          approvalPolicy: "on-request",
          developerInstructions: "",
        },
      }),
    ).toEqual({ provider: "codex", model: "gpt-5.6-sol" });
  });
});
