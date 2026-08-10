import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  HostToolDefinition,
  HostToolExecutionResult,
  HostToolInvocationContext,
} from "../hostTools/runtime.ts";

export interface HostToolRuntimeShape {
  readonly catalog: ReadonlyArray<HostToolDefinition>;
  readonly list: (
    context: HostToolInvocationContext,
  ) => Effect.Effect<ReadonlyArray<HostToolDefinition>>;
  readonly execute: (input: {
    readonly name: string;
    readonly arguments: Record<string, unknown>;
    readonly context: HostToolInvocationContext;
  }) => Effect.Effect<HostToolExecutionResult>;
}

export class HostToolRuntime extends ServiceMap.Service<HostToolRuntime, HostToolRuntimeShape>()(
  "veylen/orchestration/Services/HostToolRuntime",
) {}
