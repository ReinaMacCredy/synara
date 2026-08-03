import { Effect, Layer } from "effect";

import { makeOrchestratorTools } from "../orchestrator/toolRegistry.ts";
import { OrchestratorToolError, orchestratorToolFailure } from "../orchestrator/toolRuntime.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestratorToolRuntime } from "../Services/OrchestratorToolRuntime.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestratorArtifactRepository } from "../../persistence/Services/OrchestratorArtifacts.ts";
import { ProjectionOrchestratorRepository } from "../../persistence/Services/ProjectionOrchestrator.ts";
import { ProjectionTaskProcessRepository } from "../../persistence/Services/ProjectionTaskProcess.ts";
import { OrchestrationLayerLive } from "../runtimeLayer.ts";
import { OrchestratorArtifactRepositoryLive } from "../../persistence/Layers/OrchestratorArtifacts.ts";
import { ProjectionOrchestratorRepositoryLive } from "../../persistence/Layers/ProjectionOrchestrator.ts";
import { ProjectionTaskProcessRepositoryLive } from "../../persistence/Layers/ProjectionTaskProcess.ts";
import { makeHandoffDestinationTools } from "../../handoff/handoffDestinationToolRegistry.ts";

const makeOrchestratorToolRuntime = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const entries = [
    ...makeOrchestratorTools({
      orchestratorRepository: yield* ProjectionOrchestratorRepository,
      taskProcessRepository: yield* ProjectionTaskProcessRepository,
      artifactRepository: yield* OrchestratorArtifactRepository,
      orchestrationEngine: yield* OrchestrationEngineService,
      snapshotQuery,
    }),
    ...makeHandoffDestinationTools({ snapshotQuery }),
  ];
  const byName = new Map(entries.map((entry) => [entry.definition.name, entry]));

  return OrchestratorToolRuntime.of({
    catalog: entries.map((entry) => entry.definition),
    list: (context) =>
      Effect.filter(entries, (entry) => entry.isVisible(context), { concurrency: 1 }).pipe(
        Effect.map((visible) => visible.map((entry) => entry.definition)),
      ),
    execute: ({ name, arguments: args, context }) => {
      const entry = byName.get(name as never);
      if (!entry) {
        return Effect.succeed(
          orchestratorToolFailure(
            new OrchestratorToolError(
              "orchestrator_tool_unknown",
              `Unknown Orchestrator tool: ${name}`,
            ),
          ),
        );
      }
      return entry
        .isVisible(context)
        .pipe(
          Effect.flatMap((visible) =>
            visible
              ? entry.execute(args, context)
              : Effect.succeed(
                  orchestratorToolFailure(
                    new OrchestratorToolError(
                      "orchestrator_capability_denied",
                      `This thread cannot call ${entry.definition.displayName}.`,
                    ),
                  ),
                ),
          ),
        );
    },
  });
});

export const OrchestratorToolRuntimeLive = Layer.effect(
  OrchestratorToolRuntime,
  makeOrchestratorToolRuntime,
);

export const OrchestratorToolRuntimeConfiguredLive = OrchestratorToolRuntimeLive.pipe(
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(OrchestratorArtifactRepositoryLive),
  Layer.provideMerge(ProjectionOrchestratorRepositoryLive),
  Layer.provideMerge(ProjectionTaskProcessRepositoryLive),
);
