// FILE: orchestratorMcpTools.ts
// Purpose: Project OrchestratorToolRuntime into Agent Gateway MCP ToolEntry rows.
// Unified host path: Codex, Claude, Grok, Cursor, … all call these tools the same
// way as ordinary MCP tools (grep/ls style), not a provider-private surface.
// Layer: Agent gateway
// Exports: makeAgentGatewayOrchestratorTools

import type { OrchestratorToolName, ProviderKind } from "@synara/contracts";
import { Effect, Option } from "effect";

import type { OrchestratorToolRuntimeShape } from "../orchestration/Services/OrchestratorToolRuntime.ts";
import type { ProviderDiscoveryServiceShape } from "../provider/Services/ProviderDiscoveryService.ts";
import {
  listAllOrchestratorProviderCapabilities,
  resolveOrchestratorProviderCapability,
} from "../orchestration/orchestrator/providerCapabilityDiscovery.ts";
import {
  OrchestratorToolError,
  type OrchestratorToolInvocationContext,
} from "../orchestration/orchestrator/toolRuntime.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";

function buildOrchestratorToolContext(
  context: ToolContext,
  discovery: ProviderDiscoveryServiceShape | null,
): OrchestratorToolInvocationContext {
  const listOrchestratorCapabilities = () =>
    discovery
      ? listAllOrchestratorProviderCapabilities(discovery)
      : Effect.succeed([]);
  return {
    callerThreadId: context.callerThreadId,
    callerSessionKey: context.callerSessionKey,
    callerProvider: context.callerProvider,
    callerTurnId: context.callerTurnId,
    listOrchestratorCapabilities,
    resolveOrchestratorCapability: (input: {
      readonly provider: ProviderKind;
      readonly model: string;
    }) =>
      discovery
        ? resolveOrchestratorProviderCapability({
            discovery,
            provider: input.provider,
            model: input.model,
          })
        : Effect.fail(
            new OrchestratorToolError(
              "provider_capability_unavailable",
              "Multi-provider model discovery is unavailable for this MCP session.",
            ),
          ),
    assertCallerTurnActive: () =>
      context.assertCallerTurnActive().pipe(
        Effect.mapError(
          (error) =>
            new OrchestratorToolError(
              "caller_turn_inactive",
              error instanceof Error ? error.message : String(error),
            ),
        ),
      ),
  };
}

export function makeAgentGatewayOrchestratorTools(input: {
  readonly runtime: OrchestratorToolRuntimeShape;
  readonly discovery: ProviderDiscoveryServiceShape | null;
}): ReadonlyArray<ToolEntry> {
  return input.runtime.catalog.map((definition) => {
    const readOnly = definition.readOnly;
    return {
      requiredCapability: readOnly ? ("thread:read" as const) : ("thread:write" as const),
      requiresActiveTurn: !readOnly,
      definition: {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema as Record<string, unknown>,
        annotations: {
          title: definition.displayName,
          ...(readOnly ? READ_ONLY_TOOL_ANNOTATIONS : WRITE_TOOL_ANNOTATIONS),
        },
      },
      isVisible: (context) =>
        input.runtime
          .list(buildOrchestratorToolContext(context as ToolContext, input.discovery))
          .pipe(
            Effect.map((visible) => visible.some((entry) => entry.name === definition.name)),
            Effect.orElseSucceed(() => false),
          ),
      handler: (args, context) =>
        input.runtime
          .execute({
            name: definition.name as OrchestratorToolName,
            arguments: args,
            context: buildOrchestratorToolContext(context, input.discovery),
          })
          .pipe(
            Effect.map((result) =>
              result.ok
                ? mcpToolResultJson(result.value)
                : mcpToolResultError(
                    JSON.stringify({
                      code: result.error.code,
                      message: result.error.message,
                      ...(result.error.details === undefined
                        ? {}
                        : { details: result.error.details }),
                    }),
                  ),
            ),
          ),
    } satisfies ToolEntry;
  });
}

export function optionalAgentGatewayOrchestratorTools(input: {
  readonly runtime: Option.Option<OrchestratorToolRuntimeShape>;
  readonly discovery: Option.Option<ProviderDiscoveryServiceShape>;
}): ReadonlyArray<ToolEntry> {
  if (Option.isNone(input.runtime)) return [];
  return makeAgentGatewayOrchestratorTools({
    runtime: input.runtime.value,
    discovery: Option.getOrNull(input.discovery),
  });
}
