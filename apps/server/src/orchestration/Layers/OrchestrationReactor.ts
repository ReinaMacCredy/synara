import { Effect, Layer } from "effect";

import {
  OrchestrationReactor,
  type OrchestrationReactorShape,
} from "../Services/OrchestrationReactor.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { SupervisionWakeReactor } from "../Services/SupervisionWakeReactor.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const supervisionWakeReactor = yield* SupervisionWakeReactor;

  const start: OrchestrationReactorShape["start"] = Effect.gen(function* () {
    yield* checkpointReactor.start;
    yield* providerRuntimeIngestion.start;
    yield* supervisionWakeReactor.start;
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
