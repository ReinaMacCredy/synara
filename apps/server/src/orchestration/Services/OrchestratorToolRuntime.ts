import type { OrchestratorToolName } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  OrchestratorToolDefinition,
  OrchestratorToolExecutionResult,
  OrchestratorToolInvocationContext,
} from "../orchestrator/toolRuntime.ts";

export interface OrchestratorToolRuntimeShape {
  readonly catalog: ReadonlyArray<OrchestratorToolDefinition>;
  readonly list: (
    context: OrchestratorToolInvocationContext,
  ) => Effect.Effect<ReadonlyArray<OrchestratorToolDefinition>>;
  readonly execute: (input: {
    readonly name: OrchestratorToolName | string;
    readonly arguments: Record<string, unknown>;
    readonly context: OrchestratorToolInvocationContext;
  }) => Effect.Effect<OrchestratorToolExecutionResult>;
}

export class OrchestratorToolRuntime extends ServiceMap.Service<
  OrchestratorToolRuntime,
  OrchestratorToolRuntimeShape
>()("synara/orchestration/Services/OrchestratorToolRuntime") {}
