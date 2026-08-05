// FILE: claudeOrchestratorSdkMcp.ts
// Purpose: Install class B — Claude Agent SDK in-process MCP server that exposes
// the same OrchestratorToolRuntime catalog (not a second tool surface).
// Layer: Claude provider host-tool install
// Exports: buildClaudeOrchestratorSdkMcpServers

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { OrchestratorToolName, ProviderKind } from "@synara/contracts";
import { Effect, Option } from "effect";
import { z } from "zod";

import type { OrchestratorToolRuntimeShape } from "../orchestration/Services/OrchestratorToolRuntime.ts";
import type { ProviderDiscoveryServiceShape } from "./Services/ProviderDiscoveryService.ts";
import {
  listAllOrchestratorProviderCapabilities,
  resolveOrchestratorProviderCapability,
} from "../orchestration/orchestrator/providerCapabilityDiscovery.ts";
import {
  OrchestratorToolError,
  type OrchestratorToolInvocationContext,
} from "../orchestration/orchestrator/toolRuntime.ts";
import { SYNARA_ORCHESTRATOR_MCP_SERVER_NAME } from "../orchestration/orchestrator/hostToolInstall.ts";

function buildInvocationContext(input: {
  readonly threadId: string;
  readonly provider: ProviderKind;
  readonly discovery: ProviderDiscoveryServiceShape | null;
}): OrchestratorToolInvocationContext {
  const listOrchestratorCapabilities = () =>
    input.discovery
      ? listAllOrchestratorProviderCapabilities(input.discovery)
      : Effect.succeed([]);
  return {
    callerThreadId: input.threadId,
    callerSessionKey: `claudeAgent:${input.threadId}`,
    callerProvider: input.provider,
    callerTurnId: null,
    listOrchestratorCapabilities,
    resolveOrchestratorCapability: (request) =>
      input.discovery
        ? resolveOrchestratorProviderCapability({
            discovery: input.discovery,
            provider: request.provider,
            model: request.model,
          })
        : Effect.fail(
            new OrchestratorToolError(
              "provider_capability_unavailable",
              "Multi-provider model discovery is unavailable for this Claude session.",
            ),
          ),
    assertCallerTurnActive: () => Effect.void,
  };
}

/**
 * Build an in-process SDK MCP server for Orchestrator host tools.
 * Handlers dispatch into OrchestratorToolRuntime (same as Codex native + ACP gateway).
 */
export function buildClaudeOrchestratorSdkMcpServer(input: {
  readonly runtime: OrchestratorToolRuntimeShape;
  readonly discovery: ProviderDiscoveryServiceShape | null;
  readonly threadId: string;
  readonly provider?: ProviderKind;
}): ReturnType<typeof createSdkMcpServer> {
  const provider = input.provider ?? "claudeAgent";
  const context = buildInvocationContext({
    threadId: input.threadId,
    provider,
    discovery: input.discovery,
  });

  // JSON Schema from the catalog is more accurate than a hand-rolled Zod shape;
  // cast through `tool()` so the SDK still gets an in-process server instance.
  const tools = input.runtime.catalog.map((definition) =>
    tool(
      definition.name,
      definition.description,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- open object for JSON-Schema tools
      z.object({}).passthrough() as any,
      async (args) => {
        const result = await Effect.runPromise(
          input.runtime
            .execute({
              name: definition.name as OrchestratorToolName,
              arguments: (args ?? {}) as Record<string, unknown>,
              context,
            })
            .pipe(Effect.orDie),
        );
        if (result.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result.value, null, 2),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  code: result.error.code,
                  message: result.error.message,
                  ...(result.error.details === undefined
                    ? {}
                    : { details: result.error.details }),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      },
      {
        annotations: {
          readOnlyHint: definition.readOnly,
          destructiveHint: !definition.readOnly,
          openWorldHint: false,
        },
      },
    ),
  );

  return createSdkMcpServer({
    name: SYNARA_ORCHESTRATOR_MCP_SERVER_NAME,
    version: "1.0.0",
    instructions:
      "Synara Orchestrator host tools. Call create_child_thread, list_provider_capabilities, send_message, and related tools like any other host tool.",
    tools,
    alwaysLoad: true,
  });
}

export function buildClaudeHostMcpServers(input: {
  readonly httpConnection: { readonly url: string; readonly bearerToken: string } | null;
  readonly orchestratorRuntime: Option.Option<OrchestratorToolRuntimeShape>;
  readonly discovery: Option.Option<ProviderDiscoveryServiceShape>;
  readonly threadId: string;
  readonly isOrchestratorSession: boolean;
}): Record<string, unknown> {
  const servers: Record<string, unknown> = {};

  // Ordinary Synara tools (threads, browser, …) stay on authenticated HTTP MCP.
  if (input.httpConnection) {
    servers.synara = {
      type: "http",
      url: input.httpConnection.url,
      headers: { Authorization: `Bearer ${input.httpConnection.bearerToken}` },
    };
  }

  // Install class B: Orchestrator tools in-process so Claude does not need a
  // second hop for create_child_thread / list_provider_capabilities / …
  if (input.isOrchestratorSession && Option.isSome(input.orchestratorRuntime)) {
    servers["synara-orchestrator"] = buildClaudeOrchestratorSdkMcpServer({
      runtime: input.orchestratorRuntime.value,
      discovery: Option.getOrNull(input.discovery),
      threadId: input.threadId,
      provider: "claudeAgent",
    });
  }

  return servers;
}
