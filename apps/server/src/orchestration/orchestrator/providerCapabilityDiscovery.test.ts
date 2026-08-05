import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import type { OrchestratorProviderCapability } from "@synara/contracts";

import {
  isOrchestratorModelTargetCapable,
  listAllOrchestratorProviderCapabilities,
  resolveOrchestratorProviderCapability,
} from "./providerCapabilityDiscovery.ts";
import { OrchestratorToolError } from "./toolRuntime.ts";

const capable = (
  provider: string,
  model: string,
  flags?: Partial<
    Pick<
      OrchestratorProviderCapability,
      "orchestratorCapable" | "authoritativeRoleInstruction" | "nativeTools" | "independentSession"
    >
  >,
): OrchestratorProviderCapability =>
  ({
    provider,
    model,
    orchestratorCapable: flags?.orchestratorCapable ?? true,
    authoritativeRoleInstruction: flags?.authoritativeRoleInstruction ?? true,
    nativeTools: flags?.nativeTools ?? true,
    independentSession: flags?.independentSession ?? true,
    contextWindow: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    inputTokens: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    outputTokens: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    cacheReadTokens: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    cacheWriteTokens: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    cacheTtlSeconds: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    estimatedCost: { kind: "unknown", reason: "test", at: "2026-01-01T00:00:00.000Z" },
    observedAt: "2026-01-01T00:00:00.000Z",
  }) as OrchestratorProviderCapability;

describe("providerCapabilityDiscovery", () => {
  it("merges capabilities across providers and skips failing providers", async () => {
    const discovery = {
      listOrchestratorCapabilities: (input: { provider: string }) => {
        if (input.provider === "codex") {
          return Effect.succeed([capable("codex", "gpt-5.4")]);
        }
        if (input.provider === "claudeAgent") {
          return Effect.succeed([capable("claudeAgent", "claude-opus-4")]);
        }
        if (input.provider === "cursor") {
          return Effect.fail(new Error("offline"));
        }
        return Effect.succeed([]);
      },
    };

    const listed = await Effect.runPromise(
      listAllOrchestratorProviderCapabilities(discovery as never),
    );
    expect(listed.map((entry) => `${entry.provider}:${entry.model}`)).toEqual([
      "codex:gpt-5.4",
      "claudeAgent:claude-opus-4",
    ]);
  });

  it("resolves only fully capable model targets", async () => {
    const discovery = {
      listOrchestratorCapabilities: () =>
        Effect.succeed([
          capable("codex", "gpt-5.4"),
          capable("claudeAgent", "claude-sonnet", { nativeTools: false }),
        ]),
    };

    const ok = await Effect.runPromise(
      resolveOrchestratorProviderCapability({
        discovery: discovery as never,
        provider: "codex",
        model: "gpt-5.4",
      }),
    );
    expect(ok.model).toBe("gpt-5.4");
    expect(isOrchestratorModelTargetCapable(ok)).toBe(true);

    const missing = await Effect.runPromise(
      Effect.flip(
        resolveOrchestratorProviderCapability({
          discovery: discovery as never,
          provider: "claudeAgent",
          model: "claude-sonnet",
        }),
      ),
    );
    expect(missing).toBeInstanceOf(OrchestratorToolError);
    expect((missing as OrchestratorToolError).code).toBe("provider_native_tools_unsupported");
  });
});
