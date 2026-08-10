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
import { ThreadGitMetadataReactor } from "../Services/ThreadGitMetadataReactor.ts";

export const makeOrchestrationReactor = Effect.gen(function* () {
  const providerRuntimeIngestion = yield* ProviderRuntimeIngestionService;
  const providerCommandReactor = yield* ProviderCommandReactor;
  const checkpointReactor = yield* CheckpointReactor;
  const leadRotationReactor = yield* LeadRotationReactor;
  const supervisedWakeReactor = yield* SupervisedWakeReactor;
  const threadGitMetadataReactor = yield* ThreadGitMetadataReactor;

  const start: OrchestrationReactorShape["start"] = Effect.gen(function* () {
    yield* checkpointReactor.start;
    yield* threadGitMetadataReactor.start;
    yield* providerRuntimeIngestion.start;
    yield* supervisedWakeReactor.start;
    yield* leadRotationReactor.start;
    // Install every runtime observer before provider command dispatch can
    // begin. Reverse-order finalization then drains provider commands first,
    // Lead rotation and supervised wake observers must also be ready before
    // provider dispatch can emit work.
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
