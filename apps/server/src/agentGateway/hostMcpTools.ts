import { Effect, Option } from "effect";

import type { HostToolRuntimeShape } from "../orchestration/Services/HostToolRuntime.ts";
import { HostToolError, type HostToolInvocationContext } from "../orchestration/hostTools/runtime.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";

function buildHostToolContext(context: ToolContext): HostToolInvocationContext {
  return {
    callerThreadId: context.callerThreadId,
    callerSessionKey: context.callerSessionKey,
    callerProvider: context.callerProvider,
    callerTurnId: context.callerTurnId,
    callerDispatchOrigin: context.callerDispatchOrigin,
    assertCallerTurnActive: () =>
      context.assertCallerTurnActive().pipe(
        Effect.mapError(
          (error) =>
            new HostToolError(
              "caller_turn_inactive",
              error instanceof Error ? error.message : String(error),
            ),
        ),
      ),
  };
}

export function makeAgentGatewayHostTools(input: {
  readonly runtime: HostToolRuntimeShape;
}): ReadonlyArray<ToolEntry> {
  return input.runtime.catalog.map((definition) => ({
    requiredCapability: definition.readOnly ? ("thread:read" as const) : ("thread:write" as const),
    requiresActiveTurn: !definition.readOnly,
    definition: {
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema as Record<string, unknown>,
      annotations: {
        title: definition.displayName,
        ...(definition.readOnly ? READ_ONLY_TOOL_ANNOTATIONS : WRITE_TOOL_ANNOTATIONS),
      },
    },
    isVisible: (context) =>
      input.runtime
        .list(buildHostToolContext(context as ToolContext))
        .pipe(
          Effect.map((visible) => visible.some((entry) => entry.name === definition.name)),
          Effect.orElseSucceed(() => false),
        ),
    handler: (args, context) =>
      input.runtime
        .execute({
          name: definition.name,
          arguments: args,
          context: buildHostToolContext(context),
        })
        .pipe(
          Effect.map((result) =>
            result.ok
              ? mcpToolResultJson(result.value)
              : mcpToolResultError(JSON.stringify(result.error)),
          ),
        ),
  }));
}

export function optionalAgentGatewayHostTools(input: {
  readonly runtime: Option.Option<HostToolRuntimeShape>;
}): ReadonlyArray<ToolEntry> {
  return Option.isSome(input.runtime) ? makeAgentGatewayHostTools({ runtime: input.runtime.value }) : [];
}
