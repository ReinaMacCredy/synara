import { randomUUID } from "node:crypto";

import {
  SupervisedToolInvocationReceiptId,
  type SupervisedToolPolicy,
  type SupervisedToolInvocationReceipt,
} from "@synara/contracts";
import { Effect, Layer, Option } from "effect";

import { makeHandoffDestinationTools } from "../../handoff/handoffDestinationToolRegistry.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { SupervisedToolReceiptRepository } from "../../persistence/Services/SupervisedToolReceipts.ts";
import { SupervisedToolPolicyRepository } from "../../persistence/Services/SupervisedToolPolicies.ts";
import { ProviderHealth } from "../../provider/Services/ProviderHealth.ts";
import { providerAvailabilityFromHealth } from "../../supervised/modelRouting/ModelRouting.ts";
import { authorizeSupervisedIntentTool } from "../../supervised/tools/Registry.ts";
import {
  ModelRoutingService,
  ModelRoutingServiceLive,
} from "../../supervised/modelRouting/ModelRoutingService.ts";
import { HostToolError, hostToolFailure } from "../hostTools/runtime.ts";
import { OrchestrationLayerLive } from "../runtimeLayer.ts";
import { HostToolRuntime } from "../Services/HostToolRuntime.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { SupervisedRuntimeDaemon } from "../Services/SupervisedRuntimeDaemon.ts";
import {
  resolveEffectiveCanonicalAuthority,
  resolveProjectedSupervisedCaller,
} from "../supervised/canonicalCaller.ts";
import { makeSupervisedTools } from "../supervised/toolRegistry.ts";

export type SupervisedToolPolicyDecision =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly code: string; readonly reason: string };

export const evaluateSupervisedToolPolicy = (
  policy: SupervisedToolPolicy | null | undefined,
): SupervisedToolPolicyDecision => {
  if (!policy || policy.state === "enabled") return { enabled: true };
  return {
    enabled: false,
    code:
      policy.state === "revoked"
        ? "supervised_tool_policy_revoked"
        : "supervised_tool_policy_disabled",
    reason: `Supervised tool '${policy.toolId}' is ${policy.state} by owner policy.`,
  };
};

const makeHostToolRuntime = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const governanceRepository = yield* SupervisedGovernanceRepository;
  const toolReceiptRepository = yield* SupervisedToolReceiptRepository;
  const toolPolicyRepository = yield* SupervisedToolPolicyRepository;
  const providerHealth = yield* ProviderHealth;
  const entries = [
    ...makeHandoffDestinationTools({ snapshotQuery }),
    ...makeSupervisedTools({
      orchestrationEngine: yield* OrchestrationEngineService,
      snapshotQuery,
      governanceRepository,
      runtimeDaemon: yield* SupervisedRuntimeDaemon,
      modelRoutingService: yield* ModelRoutingService,
      getProviderAvailability: () =>
        providerHealth.getStatuses.pipe(Effect.map(providerAvailabilityFromHealth)),
    }),
  ];
  const byName = new Map(entries.map((entry) => [entry.definition.name, entry]));

  const loadCanonicalCaller = (context: Parameters<(typeof entries)[number]["isVisible"]>[0]) =>
    Effect.gen(function* () {
      const governance = yield* governanceRepository
        .getSnapshot()
        .pipe(
          Effect.mapError(
            (error) =>
              new HostToolError(
                "supervised_tool_authority_unavailable",
                error instanceof Error ? error.message : String(error),
              ),
          ),
        );
      const caller = resolveProjectedSupervisedCaller({
        governance,
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
          : (seat?.roomIds[0] ?? null);
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
      yield* toolReceiptRepository
        .insert(receipt)
        .pipe(
          Effect.mapError(
            (error) => new HostToolError("supervised_tool_receipt_unavailable", error.message),
          ),
        );
      const executeRequestedTool = Effect.gen(function* () {
        const policy = yield* toolPolicyRepository
          .getByToolId(metadata.toolId)
          .pipe(
            Effect.mapError(
              (error) =>
                new HostToolError(
                  "supervised_tool_policy_unavailable",
                  error instanceof Error ? error.message : String(error),
                ),
            ),
          );
        const policyDecision = evaluateSupervisedToolPolicy(
          Option.isSome(policy) ? policy.value : null,
        );
        if (!policyDecision.enabled) {
          const failure = new HostToolError(policyDecision.code, policyDecision.reason);
          const completed = yield* completeReceipt(receipt, "denied", failure).pipe(
            Effect.mapError(
              (error) => new HostToolError("supervised_tool_receipt_unavailable", error.message),
            ),
          );
          return { ...hostToolFailure(failure), receipt: completed };
        }
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
        const policyState = yield* toolPolicyRepository.list().pipe(
          Effect.map((policies) => ({
            available: true as const,
            byToolId: new Map(policies.map((policy) => [policy.toolId, policy])),
          })),
          Effect.catch(() =>
            Effect.succeed({
              available: false as const,
              byToolId: new Map(),
            }),
          ),
        );
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
                if (!policyState.available) return false;
                if (
                  !evaluateSupervisedToolPolicy(
                    policyState.byToolId.get(entry.definition.supervised.toolId),
                  ).enabled
                )
                  return false;
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
      return entry
        .isVisible(context)
        .pipe(
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
  Layer.provideMerge(ModelRoutingServiceLive.pipe(Layer.provideMerge(OrchestrationLayerLive))),
);
