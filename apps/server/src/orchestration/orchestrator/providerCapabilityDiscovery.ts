// FILE: providerCapabilityDiscovery.ts
// Purpose: List Orchestrator-capable models across every Synara provider so native
// and MCP tool surfaces share one multi-provider capability view (not Codex-only).
// Layer: Orchestration tool support
// Exports: listAllOrchestratorProviderCapabilities, resolveOrchestratorProviderCapability

import type { OrchestratorProviderCapability, ProviderKind } from "@synara/contracts";
import { Effect } from "effect";

import type { ProviderDiscoveryServiceShape } from "../../provider/Services/ProviderDiscoveryService.ts";
import { OrchestratorToolError } from "./toolRuntime.ts";

export const ORCHESTRATOR_PROVIDER_KINDS: ReadonlyArray<ProviderKind> = [
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
];

export function listAllOrchestratorProviderCapabilities(
  discovery: ProviderDiscoveryServiceShape,
): Effect.Effect<ReadonlyArray<OrchestratorProviderCapability>, never> {
  return Effect.forEach(
    ORCHESTRATOR_PROVIDER_KINDS,
    (provider) =>
      discovery.listOrchestratorCapabilities({ provider }).pipe(
        Effect.catch(() => Effect.succeed([] as ReadonlyArray<OrchestratorProviderCapability>)),
      ),
    { concurrency: 3 },
  ).pipe(Effect.map((groups) => groups.flat()));
}

export function isOrchestratorModelTargetCapable(
  capability: OrchestratorProviderCapability,
): boolean {
  return (
    capability.orchestratorCapable === true &&
    capability.authoritativeRoleInstruction === true &&
    capability.nativeTools === true &&
    capability.independentSession === true
  );
}

export function resolveOrchestratorProviderCapability(input: {
  readonly discovery: ProviderDiscoveryServiceShape;
  readonly provider: ProviderKind;
  readonly model: string;
}): Effect.Effect<OrchestratorProviderCapability, OrchestratorToolError> {
  return listAllOrchestratorProviderCapabilities(input.discovery).pipe(
    Effect.flatMap((capabilities) => {
      const capability = capabilities.find(
        (entry) => entry.provider === input.provider && entry.model === input.model,
      );
      if (!capability) {
        return Effect.fail(
          new OrchestratorToolError(
            "provider_model_unavailable",
            `Model "${input.model}" is not an exact available ${input.provider} model slug.`,
          ),
        );
      }
      if (!isOrchestratorModelTargetCapable(capability)) {
        return Effect.fail(
          new OrchestratorToolError(
            "provider_native_tools_unsupported",
            `Provider "${input.provider}" model "${input.model}" does not satisfy Orchestrator session requirements (authoritative role instruction, Synara tools, independent session).`,
          ),
        );
      }
      return Effect.succeed(capability);
    }),
  );
}
