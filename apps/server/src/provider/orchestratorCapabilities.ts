import type { OrchestratorProviderCapability, ProviderModelDescriptor } from "@synara/contracts";

export interface OrchestratorCapabilityFlags {
  readonly orchestratorCapable: boolean;
  readonly authoritativeRoleInstruction: boolean;
  readonly nativeTools: boolean;
  readonly independentSession: boolean;
}

function parseContextWindowTokens(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replaceAll("_", "");
  const match = /^(\d+(?:\.\d+)?)([km]?)$/.exec(normalized);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const tokens = amount * multiplier;
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}

function maximumModelContextWindow(model: ProviderModelDescriptor): number | undefined {
  const values = [
    ...(model.contextWindowOptions ?? []).map((option) => option.value),
    ...(model.defaultContextWindow ? [model.defaultContextWindow] : []),
  ]
    .map(parseContextWindowTokens)
    .filter((value): value is number => value !== undefined);
  return values.length > 0 ? Math.max(...values) : undefined;
}

const unknownTelemetry = (reason: string, at: string) => ({
  kind: "unknown" as const,
  reason,
  at,
});

export function makeOrchestratorProviderCapabilities(input: {
  readonly provider: string;
  readonly models: ReadonlyArray<ProviderModelDescriptor>;
  readonly source: string;
  readonly flags: OrchestratorCapabilityFlags;
  readonly observedAt?: string;
}): ReadonlyArray<OrchestratorProviderCapability> {
  const observedAt = input.observedAt ?? new Date().toISOString();
  return input.models.map((model) => {
    const contextWindow = maximumModelContextWindow(model);
    const runtimeUnknown = unknownTelemetry(
      "No active provider session telemetry is part of model discovery.",
      observedAt,
    );
    return {
      provider: input.provider,
      model: model.slug,
      ...input.flags,
      contextWindow:
        contextWindow === undefined
          ? unknownTelemetry(
              "Provider model discovery did not expose a numeric context-window maximum.",
              observedAt,
            )
          : {
              kind: "known" as const,
              value: contextWindow,
              source: input.source,
              at: observedAt,
            },
      inputTokens: runtimeUnknown,
      outputTokens: runtimeUnknown,
      cacheReadTokens: runtimeUnknown,
      cacheWriteTokens: runtimeUnknown,
      cacheTtlSeconds: unknownTelemetry(
        "Provider model discovery did not expose a cache TTL.",
        observedAt,
      ),
      estimatedCost: unknownTelemetry(
        "No mechanically attributable session cost is available in model discovery.",
        observedAt,
      ),
      observedAt,
    };
  });
}
