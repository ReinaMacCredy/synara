import { randomUUID } from "node:crypto";

import {
  SupervisedToolInvocationReceiptId,
  type SupervisedToolInvocationReceipt,
} from "@synara/contracts";
import { Effect, Layer } from "effect";

import { makeHandoffDestinationTools } from "../../handoff/handoffDestinationToolRegistry.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedToolReceiptRepository } from "../../persistence/Services/SupervisedToolReceipts.ts";
import { authorizeSupervisedIntentTool } from "../../supervised/tools/Registry.ts";
import { HostToolError, hostToolFailure } from "../hostTools/runtime.ts";
import { OrchestrationLayerLive } from "../runtimeLayer.ts";
import { HostToolRuntime } from "../Services/HostToolRuntime.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  resolveEffectiveCanonicalAuthority,
  resolveProjectedSupervisionCaller,
} from "../supervision/canonicalCaller.ts";
import { makeSupervisionTools } from "../supervision/toolRegistry.ts";

const makeHostToolRuntime = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const governanceRepository = yield* SupervisedGovernanceRepository;
  const toolReceiptRepository = yield* SupervisedToolReceiptRepository;
  const entries = [
    ...makeHandoffDestinationTools({ snapshotQuery }),
    ...makeSupervisionTools({
      orchestrationEngine: yield* OrchestrationEngineService,
      snapshotQuery,
      governanceRepository,
    }),
  ];
  const byName = new Map(entries.map((entry) => [entry.definition.name, entry]));

  const loadCanonicalCaller = (context: Parameters<(typeof entries)[number]["isVisible"]>[0]) =>
    Effect.gen(function* () {
      const [projection, governance] = yield* Effect.all([
        snapshotQuery.getSnapshot(),
        governanceRepository.getSnapshot(),
      ]).pipe(
        Effect.mapError(
          (error) =>
            new HostToolError(
              "supervised_tool_authority_unavailable",
              error instanceof Error ? error.message : String(error),
            ),
        ),
      );
      const caller = resolveProjectedSupervisionCaller({
        supervision: projection.supervision,
        threadId: context.callerThreadId,
      });
      if (!caller) return { seat: undefined, receipt: undefined };
      return (
        resolveEffectiveCanonicalAuthority({
          governance,
          seatId: caller.seatId,
          at: new Date().toISOString(),
        }) ?? { seat: undefined, receipt: undefined }
      );
    });

  const completeReceipt = (
    receipt: SupervisedToolInvocationReceipt,
    state: "accepted" | "projected" | "denied" | "failed",
    error: { readonly code: string; readonly message: string } | null,
  ) =>
    toolReceiptRepository.complete({
      id: receipt.id,
      state,
      completedAt: new Date().toISOString(),
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
    });

  const executeCanonical = (
    entry: (typeof entries)[number],
    args: Record<string, unknown>,
    context: Parameters<(typeof entries)[number]["execute"]>[1],
  ) =>
    Effect.gen(function* () {
      const metadata = entry.definition.supervised!;
      const { seat, receipt: authorityReceipt } = yield* loadCanonicalCaller(context);
      const requestedAt = new Date().toISOString();
      const roomId =
        typeof args.roomId === "string" && args.roomId.length > 0
          ? args.roomId
          : seat?.roomIds[0] ?? null;
      const receipt: SupervisedToolInvocationReceipt = {
        id: SupervisedToolInvocationReceiptId.makeUnsafe(randomUUID()),
        toolId: metadata.toolId,
        providerToolName: entry.definition.name,
        schemaVersion: metadata.schemaVersion,
        actorSeatId: seat?.id ?? null,
        authorityReceiptId: authorityReceipt?.id ?? null,
        workspaceId: seat?.workspaceId ?? null,
        roomId: roomId as SupervisedToolInvocationReceipt["roomId"],
        callerThreadId: context.callerThreadId,
        callerTurnId: context.callerTurnId,
        state: "requested",
        requestedAt,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
      };
      yield* toolReceiptRepository.insert(receipt).pipe(
        Effect.mapError(
          (error) => new HostToolError("supervised_tool_receipt_unavailable", error.message),
        ),
      );
      const executeRequestedTool = Effect.gen(function* () {
        const decision = authorizeSupervisedIntentTool({
          toolId: metadata.toolId,
          seat,
          receipt: authorityReceipt,
          workspaceId: seat?.workspaceId,
          roomId,
          at: requestedAt,
        });
        if (!decision.allowed) {
          const failure = new HostToolError(decision.code, decision.reason);
          const completed = yield* completeReceipt(receipt, "denied", failure).pipe(
            Effect.mapError(
              (error) => new HostToolError("supervised_tool_receipt_unavailable", error.message),
            ),
          );
          return { ...hostToolFailure(failure), receipt: completed };
        }
        const visible = yield* entry.isVisible(context);
        if (!visible) {
          const failure = new HostToolError(
            "supervised_tool_capability_denied",
            `This AgentSeat cannot call ${entry.definition.displayName}.`,
          );
          const completed = yield* completeReceipt(receipt, "denied", failure).pipe(
            Effect.mapError(
              (error) => new HostToolError("supervised_tool_receipt_unavailable", error.message),
            ),
          );
          return { ...hostToolFailure(failure), receipt: completed };
        }
        const result = yield* entry.execute(args, context);
        const error = result.ok ? null : result.error;
        const completed = yield* completeReceipt(
          receipt,
          result.ok ? (entry.definition.readOnly ? "accepted" : "projected") : "failed",
          error,
        ).pipe(
          Effect.mapError(
            (cause) => new HostToolError("supervised_tool_receipt_unavailable", cause.message),
          ),
        );
        return { ...result, receipt: completed };
      });
      return yield* executeRequestedTool.pipe(
        Effect.catch((error) => {
          const failure =
            error instanceof HostToolError
              ? error
              : new HostToolError(
                  "host_tool_failed",
                  error instanceof Error ? error.message : String(error),
                );
          return completeReceipt(receipt, "failed", failure).pipe(
            Effect.map((completed) => ({ ...hostToolFailure(failure), receipt: completed })),
            Effect.catch(() => Effect.succeed(hostToolFailure(failure))),
          );
        }),
      );
    }).pipe(Effect.catch((error) => Effect.succeed(hostToolFailure(error))));

  return HostToolRuntime.of({
    catalog: entries.map((entry) => entry.definition),
    list: (context) =>
      Effect.gen(function* () {
        const canonicalCaller = yield* loadCanonicalCaller(context).pipe(
          Effect.map((value) => ({ available: true as const, value })),
          Effect.catch(() => Effect.succeed({ available: false as const })),
        );
        const visible = yield* Effect.filter(
          entries,
          (entry) =>
            entry.isVisible(context).pipe(
              Effect.map((entryVisible) => {
                if (!entryVisible || !entry.definition.supervised) return entryVisible;
                if (!canonicalCaller.available) return false;
                const { seat, receipt } = canonicalCaller.value;
                return authorizeSupervisedIntentTool({
                  toolId: entry.definition.supervised.toolId,
                  seat,
                  receipt,
                  workspaceId: seat?.workspaceId,
                  at: new Date().toISOString(),
                }).allowed;
              }),
            ),
          { concurrency: 1 },
        );
        return visible.map((entry) => entry.definition);
      }),
    execute: ({ name, arguments: args, context }) => {
      const entry = byName.get(name);
      if (!entry) {
        return Effect.succeed(
          hostToolFailure(new HostToolError("host_tool_unknown", `Unknown host tool: ${name}`)),
        );
      }
      if (entry.definition.supervised) return executeCanonical(entry, args, context);
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
