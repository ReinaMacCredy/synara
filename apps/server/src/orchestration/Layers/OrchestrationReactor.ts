import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { OrchestratorMailbox } from "../Services/OrchestratorMailbox.ts";
import { OrchestratorMonitor } from "../Services/OrchestratorMonitor.ts";
import { SupervisionWakeReactor } from "../Services/SupervisionWakeReactor.ts";
import { LeadRotationReactor } from "../Services/LeadRotationReactor.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const orchestratorMailbox = yield* OrchestratorMailbox;
  const orchestratorMonitor = yield* OrchestratorMonitor;
  const supervisionWakeReactor = yield* SupervisionWakeReactor;
  const leadRotationReactor = yield* LeadRotationReactor;

  const start: OrchestrationReactorShape["start"] = Effect.gen(function* () {
    yield* checkpointReactor.start;
    yield* providerRuntimeIngestion.start;
    yield* orchestratorMailbox.start;
    yield* orchestratorMonitor.start;
    yield* supervisionWakeReactor.start;
    yield* leadRotationReactor.start;
    // Install every runtime observer before provider command dispatch can
    // begin. Mailbox and monitor wakes persist target-thread turns before the
    // provider command reactor can observe and execute them.
    yield* providerCommandReactor.start;
  });

  return {
    start,
    reconcileSettledOpenTurns: providerRuntimeIngestion.reconcileSettledOpenTurns,
  } satisfies OrchestrationReactorShape;
});

export const OrchestrationReactorLive = Layer.effect(
  OrchestrationReactor,
  makeOrchestrationReactor,
);
