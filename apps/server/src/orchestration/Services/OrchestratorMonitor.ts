import type { OrchestrationEvent, ThreadId } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface OrchestratorMonitorReconcileResult {
  readonly rootsVisited: number;
  readonly monitorsFired: number;
  readonly monitorsExpired: number;
  readonly monitorsCancelled: number;
  readonly wakesDispatched: number;
}

export interface OrchestratorMonitorShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly reconcileRoot: (
    rootThreadId: ThreadId,
  ) => Effect.Effect<OrchestratorMonitorReconcileResult, unknown>;
  readonly reconcileEvent: (
    event: OrchestrationEvent,
  ) => Effect.Effect<OrchestratorMonitorReconcileResult, unknown>;
  readonly reconcileAll: Effect.Effect<OrchestratorMonitorReconcileResult, unknown>;
}

export class OrchestratorMonitor extends ServiceMap.Service<
  OrchestratorMonitor,
  OrchestratorMonitorShape
>()("synara/orchestration/Services/OrchestratorMonitor") {}
