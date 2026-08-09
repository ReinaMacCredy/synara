import { Effect, Layer } from "effect";

import { makeHandoffDestinationTools } from "../../handoff/handoffDestinationToolRegistry.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { HostToolError, hostToolFailure } from "../hostTools/runtime.ts";
import { OrchestrationLayerLive } from "../runtimeLayer.ts";
import { HostToolRuntime } from "../Services/HostToolRuntime.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makeSupervisionTools } from "../supervision/toolRegistry.ts";

const makeHostToolRuntime = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const entries = [
    ...makeHandoffDestinationTools({ snapshotQuery }),
    ...makeSupervisionTools({
      orchestrationEngine: yield* OrchestrationEngineService,
      snapshotQuery,
      governanceRepository: yield* SupervisedGovernanceRepository,
    }),
  ];
  const byName = new Map(entries.map((entry) => [entry.definition.name, entry]));

  return HostToolRuntime.of({
    catalog: entries.map((entry) => entry.definition),
    list: (context) =>
      Effect.filter(entries, (entry) => entry.isVisible(context), { concurrency: 1 }).pipe(
        Effect.map((visible) => visible.map((entry) => entry.definition)),
      ),
    execute: ({ name, arguments: args, context }) => {
      const entry = byName.get(name);
      if (!entry) {
        return Effect.succeed(
          hostToolFailure(new HostToolError("host_tool_unknown", `Unknown host tool: ${name}`)),
        );
      }
      return entry.isVisible(context).pipe(
        Effect.flatMap((visible) =>
          visible
            ? entry.execute(args, context)
            : Effect.succeed(
                hostToolFailure(
                  new HostToolError(
                    "host_tool_capability_denied",
                    `This thread cannot call ${entry.definition.displayName}.`,
                  ),
                ),
              ),
        ),
      );
    },
  });
});

export const HostToolRuntimeLive = Layer.effect(HostToolRuntime, makeHostToolRuntime);

export const HostToolRuntimeConfiguredLive = HostToolRuntimeLive.pipe(
  Layer.provideMerge(OrchestrationLayerLive),
);
