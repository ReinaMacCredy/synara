import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderKind } from "@synara/contracts";
import { Effect, Option } from "effect";
import { z } from "zod";

import type { HostToolRuntimeShape } from "../orchestration/Services/HostToolRuntime.ts";
import {
  hostToolTranscriptValue,
  type HostToolDefinition,
  type HostToolInvocationContext,
} from "../orchestration/hostTools/runtime.ts";

const SYNARA_HOST_MCP_SERVER_NAME = "synara-host";

export const claudeSupportedHostToolDefinitions = (
  catalog: ReadonlyArray<HostToolDefinition>,
): ReadonlyArray<HostToolDefinition> =>
  catalog.filter((definition) => definition.providerSupport.claude === "native");

function buildInvocationContext(input: {
  readonly threadId: string;
  readonly provider: ProviderKind;
}): HostToolInvocationContext {
  return {
    callerThreadId: input.threadId,
    callerSessionKey: `claudeAgent:${input.threadId}`,
    callerProvider: input.provider,
    callerTurnId: null,
    assertCallerTurnActive: () => Effect.void,
  };
}

export function buildClaudeHostSdkMcpServer(input: {
  readonly runtime: HostToolRuntimeShape;
  readonly threadId: string;
  readonly provider?: ProviderKind;
}): ReturnType<typeof createSdkMcpServer> {
  const context = buildInvocationContext({
    threadId: input.threadId,
    provider: input.provider ?? "claudeAgent",
  });
  const tools = claudeSupportedHostToolDefinitions(input.runtime.catalog).map((definition) =>
    tool(
      definition.name,
      definition.description,
      z.object({}).passthrough(),
      async (args) => {
        const result = await Effect.runPromise(
          input.runtime
            .execute({
              name: definition.name,
              arguments: (args ?? {}) as Record<string, unknown>,
              context,
            })
            .pipe(Effect.orDie),
        );
        return result.ok
          ? {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(hostToolTranscriptValue(result), null, 2),
                },
              ],
            }
          : {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(hostToolTranscriptValue(result), null, 2),
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
    name: SYNARA_HOST_MCP_SERVER_NAME,
    version: "1.0.0",
    instructions: "Governed Synara host tools for this supervised session.",
    tools,
    alwaysLoad: true,
  });
}

export function buildClaudeHostMcpServers(input: {
  readonly httpConnection: { readonly url: string; readonly bearerToken: string } | null;
  readonly hostRuntime: Option.Option<HostToolRuntimeShape>;
  readonly threadId: string;
  readonly enableHostTools: boolean;
}): Record<string, unknown> {
  const servers: Record<string, unknown> = {};
  if (input.httpConnection) {
    servers.synara = {
      type: "http",
      url: input.httpConnection.url,
      headers: { Authorization: `Bearer ${input.httpConnection.bearerToken}` },
    };
  }
  if (
    input.enableHostTools &&
    Option.isSome(input.hostRuntime) &&
    claudeSupportedHostToolDefinitions(input.hostRuntime.value.catalog).length > 0
  ) {
    servers[SYNARA_HOST_MCP_SERVER_NAME] = buildClaudeHostSdkMcpServer({
      runtime: input.hostRuntime.value,
      threadId: input.threadId,
    });
  }
  return servers;
}
