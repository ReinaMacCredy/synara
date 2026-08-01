import type { ThreadId } from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface OrchestratorMailboxReconcileResult {
  readonly rootsVisited: number;
  readonly messagesDelivered: number;
  readonly messagesExpired: number;
  readonly messagesFailed: number;
  readonly responsesCorrelated: number;
}

export interface OrchestratorMailboxShape {
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  readonly reconcileRoot: (
    rootThreadId: ThreadId,
  ) => Effect.Effect<OrchestratorMailboxReconcileResult, unknown>;
  readonly reconcileAll: Effect.Effect<OrchestratorMailboxReconcileResult, unknown>;
}

export class OrchestratorMailbox extends ServiceMap.Service<
  OrchestratorMailbox,
  OrchestratorMailboxShape
>()("synara/orchestration/Services/OrchestratorMailbox") {}
