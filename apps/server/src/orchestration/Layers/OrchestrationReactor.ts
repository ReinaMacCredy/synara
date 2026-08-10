import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { LeadRotationReactor } from "../Services/LeadRotationReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { SupervisedWakeReactor } from "../Services/SupervisedWakeReactor.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const leadRotationReactor = yield* LeadRotationReactor;
  const supervisedWakeReactor = yield* SupervisedWakeReactor;

  const start: OrchestrationReactorShape["start"] = Effect.gen(function* () {
    yield* checkpointReactor.start;
    yield* providerRuntimeIngestion.start;
    yield* supervisedWakeReactor.start;
    yield* leadRotationReactor.start;
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
