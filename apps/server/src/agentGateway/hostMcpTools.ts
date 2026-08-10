import { Effect, Option } from "effect";

import type { HostToolRuntimeShape } from "../orchestration/Services/HostToolRuntime.ts";
import {
  HostToolError,
  hostToolTranscriptValue,
  type HostToolInvocationContext,
} from "../orchestration/hostTools/runtime.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  WRITE_TOOL_ANNOTATIONS,
  type ToolContext,
  type ToolEntry,
} from "./toolRuntime.ts";

function buildHostToolContext(
  context: Omit<ToolContext, "jsonRpcRequestId">,
): HostToolInvocationContext {
  return {
    callerThreadId: context.callerThreadId,
    callerSessionKey: context.callerSessionKey,
    callerProvider: context.callerProvider,
    callerTurnId: context.callerTurnId,
    ...(context.callerDispatchOrigin !== undefined
      ? { callerDispatchOrigin: context.callerDispatchOrigin }
      : {}),
    assertCallerTurnActive: () =>
      context
        .assertCallerTurnActive()
        .pipe(
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
  const visibleNamesByContext = new WeakMap<object, Effect.Effect<ReadonlySet<string>>>();
  const visibleNames = (context: Omit<ToolContext, "jsonRpcRequestId">) => {
    const cached = visibleNamesByContext.get(context);
    if (cached) return cached;
    const created = Effect.runSync(
      Effect.cached(
        input.runtime
          .list(buildHostToolContext(context))
          .pipe(Effect.map((definitions) => new Set(definitions.map((entry) => entry.name)))),
      ),
    );
    visibleNamesByContext.set(context, created);
    return created;
  };

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
      visibleNames(context).pipe(
        Effect.map((names) => names.has(definition.name)),
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
              ? mcpToolResultJson(hostToolTranscriptValue(result))
              : mcpToolResultError(JSON.stringify(hostToolTranscriptValue(result))),
          ),
        ),
  }));
}

export function optionalAgentGatewayHostTools(input: {
  readonly runtime: Option.Option<HostToolRuntimeShape>;
}): ReadonlyArray<ToolEntry> {
  return Option.isSome(input.runtime)
    ? makeAgentGatewayHostTools({ runtime: input.runtime.value })
    : [];
}
