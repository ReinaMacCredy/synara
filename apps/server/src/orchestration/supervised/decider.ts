import type {
  SupervisedCommand,
  SupervisedDomainEvent,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { EventId } from "@synara/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  evaluateRunPolicy,
  transitionRun,
  type RunResourceUsage,
} from "../../supervised/runtime/RunPolicy.ts";

type UnsequencedEvent = Omit<SupervisedDomainEvent, "sequence">;

const reject = (command: SupervisedCommand, detail: string) =>
  Effect.fail(
    new OrchestrationCommandInvariantError({
      commandType: command.type,
      detail,
    }),
  );

function requireRevision(
  command: SupervisedCommand,
  currentRevision: number | null,
): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (currentRevision === null) {
    return command.expectedRevision === 0
      ? Effect.void
      : reject(command, `Aggregate does not exist; expectedRevision must be 0.`);
  }
  return currentRevision === command.expectedRevision
    ? Effect.void
    : reject(
        command,
        `Revision conflict: expected ${command.expectedRevision}, current ${currentRevision}.`,
      );
}

function actorSeatId(command: SupervisedCommand): string | null {
  return command.actor.kind === "seat" ? (command.actor.seatId ?? null) : null;
}

function requireHumanOrMatchingSeat(
  command: SupervisedCommand,
  allowedSeatIds: ReadonlyArray<string | null | undefined>,
  detail: string,
) {
  if (command.actor.kind === "user" || command.actor.kind === "plugin") return Effect.void;
  const seatId = actorSeatId(command);
  return seatId !== null && allowedSeatIds.some((candidate) => candidate === seatId)
    ? Effect.void
    : reject(command, detail);
}

function requireHuman(command: SupervisedCommand, detail: string) {
  return command.actor.kind === "user" ? Effect.void : reject(command, detail);
}

function validatePluginInstallation(
  command: Extract<
    SupervisedCommand,
    { readonly type: "supervised.plugin.install" | "supervised.plugin.upgrade" }
  >,
) {
  const { installation } = command;
  if (
    installation.manifest.pluginId !== installation.pluginId ||
    installation.grant.pluginId !== installation.pluginId
  ) {
    return reject(command, "Plugin manifest, grant, and installation identities must match.");
  }
  const requestedCapabilities = new Set(installation.manifest.requestedCapabilities);
  if (installation.grant.capabilities.some((capability) => !requestedCapabilities.has(capability))) {
    return reject(command, "A PluginCapabilityGrant cannot exceed manifest-requested capabilities.");
  }
  const requestedFields = new Set(installation.manifest.requestedPayloadFields);
  if (installation.grant.payloadFields.some((field) => !requestedFields.has(field))) {
    return reject(command, "A PluginCapabilityGrant cannot expose fields absent from the manifest.");
  }
  const declaredActions = new Set(
    installation.manifest.subscriptions.flatMap(
      (subscription) => subscription.allowedActionRequests,
    ),
  );
  if (
    installation.grant.allowedActionRequests.some((action) => !declaredActions.has(action))
  ) {
    return reject(command, "A PluginCapabilityGrant cannot add undeclared action requests.");
  }
  const secretFields = new Set(
    installation.manifest.eventSchemas.flatMap((schema) =>
      Object.entries(schema.fieldClassifications)
        .filter(([, classification]) => classification === "secret")
        .map(([field]) => field),
    ),
  );
  if (installation.grant.payloadFields.some((field) => secretFields.has(field))) {
    return reject(command, "Secret EventSchema fields cannot be included in plugin payload grants.");
  }
  return Effect.void;
}

function commandRoomId(command: SupervisedCommand): string | null {
  switch (command.type) {
    case "supervised.room.create":
    case "supervised.room.update":
      return command.room.id;
    case "supervised.task.create":
      return command.task.roomId;
    case "supervised.task-node.commit":
      return command.taskNode.roomId;
      case "supervised.run.request":
        return command.run.roomId;
      case "supervised.intervention.propose":
        return command.intervention.roomId;
      case "supervised.intervention.reconcile":
        return command.reconciliation.roomId;
      case "supervised.compaction.request":
      case "supervised.handoff.request":
        return command.roomId;
    default:
      return null;
  }
}

function scopeAllowsRoom(
  scopes: ReadonlyArray<
    | { readonly kind: "global" }
    | { readonly kind: "project"; readonly projectId: string }
    | { readonly kind: "room"; readonly roomId: string }
    | { readonly kind: "task"; readonly taskId: string }
    | { readonly kind: "task_node"; readonly taskNodeId: string }
    | { readonly kind: "seat"; readonly seatId: string }
  >,
  roomId: string | null,
) {
  return scopes.some(
    (scope) => scope.kind === "global" || (scope.kind === "room" && scope.roomId === roomId),
  );
}

function runtimeUsage(state: SupervisedRuntimeSnapshot): RunResourceUsage {
  return {
    wallTimeMs: 0,
    recursiveCalls: 0,
    fanOut: 1,
    retries: 0,
    costUsd: null,
    kernelMemoryMiB: 0,
    kernelOutputBytes: 0,
    activePlugins: state.plugins.filter((plugin) => plugin.status === "enabled").length,
    activeSubscriptions: state.subscriptions.filter(
      (subscription) => subscription.state === "enabled",
    ).length,
    eventRatePerMinute: 0,
    aggregationSamples: 0,
  };
}

function requirePluginAuthority(
  command: SupervisedCommand,
  state: SupervisedRuntimeSnapshot,
): Effect.Effect<void, OrchestrationCommandInvariantError> {
  if (command.actor.kind !== "plugin") return Effect.void;
  const installation = state.plugins.find(
    (plugin) => plugin.pluginId === command.actor.actorId,
  );
  if (
    !installation ||
    installation.status !== "enabled" ||
    installation.grant.status !== "active"
  ) {
    return reject(command, "Plugin installation or capability grant is not active.");
  }
  if (
    !installation.grant.capabilities.includes("command.request") ||
    !installation.grant.allowedActionRequests.includes(command.type)
  ) {
    return reject(command, `Plugin is not granted '${command.type}'.`);
  }
  if (!scopeAllowsRoom(installation.grant.scopes, commandRoomId(command))) {
    return reject(command, "Plugin command is outside its granted authority scope.");
  }
  const policy = state.runPolicies.find((candidate) => candidate.id === command.runPolicyId);
  if (!policy) return reject(command, "Plugin command requires a current RunPolicy snapshot.");
  const decision = evaluateRunPolicy(policy, runtimeUsage(state), {
    pluginAction: command.type,
    aggregationWindowMs:
      command.type === "supervised.subscription.upsert"
        ? command.subscription.window.durationMs
        : undefined,
    replay: command.type === "supervised.delivery.redrive",
  });
  return decision.allowed ? Effect.void : reject(command, decision.reason);
}

function event(
  command: SupervisedCommand,
  type: SupervisedDomainEvent["type"],
  aggregateKind: SupervisedDomainEvent["aggregateKind"],
  acceptedRevision: number,
  payload: Omit<SupervisedDomainEvent["payload"], "acceptedRevision" | "actor">,
): UnsequencedEvent {
  return {
    eventId: EventId.makeUnsafe(crypto.randomUUID()),
    aggregateKind,
    aggregateId: command.aggregateId,
    type,
    payload: { ...payload, acceptedRevision, actor: command.actor },
    occurredAt: command.createdAt,
    commandId: command.commandId,
    causationEventId: null,
    correlationId: command.commandId,
    metadata: { schemaVersion: "1.0.0" },
  } as UnsequencedEvent;
}

export const decideSupervisedCommand = Effect.fn("decideSupervisedCommand")(function* (input: {
  readonly command: SupervisedCommand;
  readonly state: SupervisedRuntimeSnapshot;
}): Effect.fn.Return<UnsequencedEvent, OrchestrationCommandInvariantError> {
  const { command, state } = input;
  yield* requirePluginAuthority(command, state);
  switch (command.type) {
    case "supervised.room.create": {
      yield* requireHumanOrMatchingSeat(
        command,
        [command.room.leadSeatId],
        "Only the Human or assigned Lead may create this Room.",
      );
      const current = state.rooms.find((room) => room.id === command.room.id);
      if (current) return yield* reject(command, "Room already exists.");
      yield* requireRevision(command, null);
      return event(command, "supervised.room-created", "supervised_room", command.room.revision, {
        room: command.room,
      });
    }
    case "supervised.room.update": {
      const current = state.rooms.find((room) => room.id === command.room.id);
      yield* requireHumanOrMatchingSeat(
        command,
        [current?.leadSeatId],
        "Only the Human or current Room Lead may update this Room.",
      );
      if (!current) return yield* reject(command, "Room does not exist.");
      yield* requireRevision(command, current.revision);
      return event(command, "supervised.room-updated", "supervised_room", current.revision + 1, {
        room: { ...command.room, revision: current.revision + 1 },
      });
    }
    case "supervised.task.create": {
      const room = state.rooms.find((candidate) => candidate.id === command.task.roomId);
      yield* requireHumanOrMatchingSeat(
        command,
        [room?.leadSeatId],
        "Only the Human or Room Lead may create a Task.",
      );
      if (!room) {
        return yield* reject(command, "Task Room does not exist.");
      }
      const current = state.tasks.find((task) => task.id === command.task.id);
      if (current) return yield* reject(command, "Task already exists.");
      yield* requireRevision(command, null);
      return event(command, "supervised.task-created", "supervised_task", command.task.revision, {
        task: command.task,
      });
    }
    case "supervised.task-node.commit": {
      yield* requireHumanOrMatchingSeat(
        command,
        [command.taskNodeRevision.createdBy.seatId],
        "Only the Human or TaskNode revision author may commit this revision.",
      );
      if (!state.tasks.some((task) => task.id === command.taskNode.taskId)) {
        return yield* reject(command, "TaskNode Task does not exist.");
      }
      const current = state.taskNodes.find((node) => node.id === command.taskNode.id);
      yield* requireRevision(command, current?.revision ?? null);
      const revision = current ? current.revision + 1 : command.taskNode.revision;
      return event(command, "supervised.task-node-committed", "supervised_task", revision, {
        taskNode: { ...command.taskNode, revision },
        taskNodeRevision: command.taskNodeRevision,
      });
    }
    case "supervised.run.request": {
      yield* requireHumanOrMatchingSeat(
        command,
        [command.run.ownerSeatId],
        "Only the Human or Run owner may request this Run.",
      );
      if (state.runs.some((run) => run.id === command.run.id)) {
        return yield* reject(command, "Run already exists.");
      }
      if (!state.runPolicies.some((policy) => policy.id === command.run.runPolicyId)) {
        return yield* reject(command, "RunPolicy does not exist.");
      }
      yield* requireRevision(command, null);
      return event(command, "supervised.run-requested", "supervised_run", command.run.revision, {
        run: command.run,
      });
    }
    case "supervised.run.transition": {
      const current = state.runs.find((run) => run.id === command.runId);
      yield* requireHumanOrMatchingSeat(
        command,
        [current?.ownerSeatId],
        "Only the Human or Run owner may transition this Run.",
      );
      if (!current) return yield* reject(command, "Run does not exist.");
      yield* requireRevision(command, current.revision);
      let run;
      try {
        run = transitionRun(current, command.status, command.createdAt);
      } catch (cause) {
        return yield* reject(command, cause instanceof Error ? cause.message : String(cause));
      }
      return event(command, "supervised.run-transitioned", "supervised_run", run.revision, {
        run,
        metadata: { reason: command.reason },
      });
    }
      case "supervised.run-policy.upsert": {
      yield* requireHuman(command, "Only the Human may change a RunPolicy.");
      const current = state.runPolicies.find(
        (policy) => policy.id === command.runPolicy.id,
      );
      yield* requireRevision(command, current?.revision ?? null);
      const revision = current ? current.revision + 1 : command.runPolicy.revision;
      return event(command, "supervised.run-policy-upserted", "run_policy", revision, {
        runPolicy: {
          ...command.runPolicy,
          revision,
          updatedAt: command.createdAt,
        },
        });
      }
      case "supervised.claim.acquire": {
        const run = state.runs.find((candidate) => candidate.id === command.claim.runId);
        yield* requireHumanOrMatchingSeat(
          command,
          [run?.ownerSeatId],
          "Only the Human or Run owner may acquire a WorkClaim.",
        );
        if (!run) return yield* reject(command, "WorkClaim Run does not exist.");
        if (
          run.taskNodeId !== command.claim.taskNodeId ||
          run.taskNodeRevisionId !== command.claim.taskNodeRevisionId
        ) {
          return yield* reject(command, "WorkClaim must match the Run TaskNode revision.");
        }
        if (Date.parse(command.claim.expiresAt) <= Date.parse(command.claim.acquiredAt)) {
          return yield* reject(command, "WorkClaim expiry must be after acquisition.");
        }
        if (
          state.workClaims.some(
            (claim) =>
              claim.status === "active" &&
              claim.taskNodeRevisionId === command.claim.taskNodeRevisionId,
          )
        ) {
          return yield* reject(command, "TaskNode revision already has an active WorkClaim.");
        }
        yield* requireRevision(command, null);
        return event(command, "supervised.claim-acquired", "work_claim", command.claim.revision, {
          workClaim: command.claim,
        });
      }
      case "supervised.claim.release":
      case "supervised.claim.revoke":
      case "supervised.claim.expire": {
        const current = state.workClaims.find((claim) => claim.id === command.claimId);
        const run = current
          ? state.runs.find((candidate) => candidate.id === current.runId)
          : undefined;
        if (command.type === "supervised.claim.expire") {
          if (command.actor.kind !== "daemon" && command.actor.kind !== "user") {
            return yield* reject(command, "Only the daemon or Human may expire a WorkClaim.");
          }
        } else {
          yield* requireHumanOrMatchingSeat(
            command,
            [run?.ownerSeatId],
            "Only the Human or Run owner may release or revoke a WorkClaim.",
          );
        }
        if (!current) return yield* reject(command, "WorkClaim does not exist.");
        if (current.status !== "active") return yield* reject(command, "WorkClaim is not active.");
        yield* requireRevision(command, current.revision);
        const status = command.type.endsWith("release")
          ? "released"
          : command.type.endsWith("expire")
            ? "expired"
            : "revoked";
        const workClaim = {
          ...current,
          status,
          releasedAt: command.createdAt,
          revision: current.revision + 1,
        };
        return event(command, "supervised.claim-state-changed", "work_claim", workClaim.revision, {
          workClaim,
        });
      }
      case "supervised.lease.grant": {
        const run = state.runs.find((candidate) => candidate.id === command.lease.runId);
        if (command.actor.kind !== "daemon") {
          yield* requireHumanOrMatchingSeat(
            command,
            [run?.ownerSeatId],
            "Only the Human, daemon, or Run owner may grant a CapabilityLease.",
          );
        }
        if (!run) return yield* reject(command, "CapabilityLease Run does not exist.");
        const policy = state.runPolicies.find((candidate) => candidate.id === run.policyId);
        if (!policy?.allowedCapabilities.includes(command.lease.capability)) {
          return yield* reject(command, "Capability is not allowed by the RunPolicy snapshot.");
        }
        if (Date.parse(command.lease.expiresAt) <= Date.parse(command.lease.grantedAt)) {
          return yield* reject(command, "CapabilityLease expiry must be after its grant.");
        }
        yield* requireRevision(command, null);
        return event(command, "supervised.lease-granted", "capability_lease", command.lease.revision, {
          capabilityLease: command.lease,
        });
      }
      case "supervised.lease.revoke":
      case "supervised.lease.expire": {
        const current = state.capabilityLeases.find((lease) => lease.id === command.leaseId);
        const run = current
          ? state.runs.find((candidate) => candidate.id === current.runId)
          : undefined;
        if (command.type === "supervised.lease.expire") {
          if (command.actor.kind !== "daemon" && command.actor.kind !== "user") {
            return yield* reject(command, "Only the daemon or Human may expire a CapabilityLease.");
          }
        } else {
          yield* requireHumanOrMatchingSeat(
            command,
            [run?.ownerSeatId],
            "Only the Human or Run owner may revoke a CapabilityLease.",
          );
        }
        if (!current) return yield* reject(command, "CapabilityLease does not exist.");
        if (current.status !== "active") return yield* reject(command, "CapabilityLease is not active.");
        yield* requireRevision(command, current.revision);
        const capabilityLease = {
          ...current,
          status: command.type.endsWith("expire") ? "expired" as const : "revoked" as const,
          revision: current.revision + 1,
        };
        return event(command, "supervised.lease-state-changed", "capability_lease", capabilityLease.revision, {
          capabilityLease,
        });
      }
      case "supervised.context.workspace-upsert": {
        const room = command.workspace.roomId
          ? state.rooms.find((candidate) => candidate.id === command.workspace.roomId)
          : undefined;
        yield* requireHumanOrMatchingSeat(
          command,
          [room?.leadSeatId],
          "Only the Human or Room Lead may create or update a Context Workspace.",
        );
        const current = state.contextWorkspaces.find(
          (workspace) => workspace.id === command.workspace.id,
        );
        yield* requireRevision(command, current?.revision ?? null);
        const revision = current ? current.revision + 1 : command.workspace.revision;
        return event(command, "supervised.context-workspace-upserted", "context_workspace", revision, {
          contextWorkspace: { ...command.workspace, revision, updatedAt: command.createdAt },
        });
      }
    case "supervised.subscription.upsert": {
      yield* requireHumanOrMatchingSeat(
        command,
        [command.subscription.ownerLeadSeatId],
        "Only the Human or owning Lead may change this subscription.",
      );
      const current = state.subscriptions.find((item) => item.id === command.subscription.id);
      yield* requireRevision(command, current?.revision ?? null);
      const revision = current ? current.revision + 1 : command.subscription.revision;
      return event(command, "supervised.subscription-upserted", "subscription", revision, {
        subscription: { ...command.subscription, revision, updatedBy: command.actor, updatedAt: command.createdAt },
      });
    }
    case "supervised.subscription.pause":
    case "supervised.subscription.enable":
    case "supervised.subscription.revoke": {
      const current = state.subscriptions.find((item) => item.id === command.subscriptionId);
      yield* requireHumanOrMatchingSeat(
        command,
        [current?.ownerLeadSeatId],
        "Only the Human or owning Lead may change this subscription.",
      );
      if (!current) return yield* reject(command, "Subscription does not exist.");
      yield* requireRevision(command, current.revision);
      if (current.state === "revoked") return yield* reject(command, "Revoked subscriptions are terminal.");
      const stateValue = command.type.endsWith("pause")
        ? "paused"
        : command.type.endsWith("enable")
          ? "enabled"
          : "revoked";
      const subscription = {
        ...current,
        state: stateValue,
        armed: stateValue === "enabled" ? current.armed : false,
        revision: current.revision + 1,
        updatedBy: command.actor,
        updatedAt: command.createdAt,
      };
      return event(command, "supervised.subscription-state-changed", "subscription", subscription.revision, {
        subscription,
      });
    }
    case "supervised.plugin.install": {
      yield* requireHuman(command, "Only the Human may install a plugin or grant capabilities.");
      yield* validatePluginInstallation(command);
      if (state.plugins.some((plugin) => plugin.pluginId === command.installation.pluginId)) {
        return yield* reject(command, "Plugin is already installed.");
      }
      yield* requireRevision(command, null);
      return event(command, "supervised.plugin-installed", "plugin", command.installation.revision, {
        plugin: command.installation,
      });
    }
    case "supervised.plugin.upgrade": {
      yield* requireHuman(command, "Only the Human may upgrade a plugin or replace its grants.");
      yield* validatePluginInstallation(command);
      const current = state.plugins.find(
        (plugin) => plugin.pluginId === command.installation.pluginId,
      );
      if (!current) return yield* reject(command, "Plugin is not installed.");
      if (current.status === "revoked") {
        return yield* reject(command, "Revoked plugin identities are terminal.");
      }
      yield* requireRevision(command, current.revision);
      if (
        current.manifest.version === command.installation.manifest.version &&
        current.manifest.provenance.contentHash ===
          command.installation.manifest.provenance.contentHash
      ) {
        return yield* reject(command, "Plugin package is identical to the installed version.");
      }
      return event(
        command,
        "supervised.plugin-upgraded",
        "plugin",
        current.revision + 1,
        {
          plugin: {
            ...command.installation,
            installedAt: current.installedAt,
            revision: current.revision + 1,
          },
        },
      );
    }
    case "supervised.plugin.enable":
    case "supervised.plugin.disable":
    case "supervised.plugin.revoke": {
      yield* requireHuman(command, "Only the Human may change plugin lifecycle or grants.");
      const current = state.plugins.find((plugin) => plugin.pluginId === command.pluginId);
      if (!current) return yield* reject(command, "Plugin is not installed.");
      yield* requireRevision(command, current.revision);
      if (current.status === "revoked") return yield* reject(command, "Revoked plugins are terminal.");
      const status = command.type.endsWith("enable")
        ? "enabled"
        : command.type.endsWith("disable")
          ? "disabled"
          : "revoked";
      const plugin = {
        ...current,
        status,
        grant: status === "revoked"
          ? { ...current.grant, status: "revoked" as const, revokedAt: command.createdAt, revision: current.grant.revision + 1 }
          : current.grant,
        revision: current.revision + 1,
        updatedAt: command.createdAt,
      };
      return event(command, "supervised.plugin-state-changed", "plugin", plugin.revision, { plugin });
    }
    case "supervised.plugin.reset-circuit": {
      yield* requireHuman(command, "Only the Human may reset a plugin circuit breaker.");
      const plugin = state.plugins.find((candidate) => candidate.pluginId === command.pluginId);
      if (!plugin) return yield* reject(command, "Plugin is not installed.");
      yield* requireRevision(command, plugin.revision);
      const current = state.pluginHealth.find(
        (candidate) => candidate.pluginId === command.pluginId,
      );
      return event(command, "supervised.plugin-circuit-reset", "plugin", plugin.revision, {
        pluginHealth: {
          pluginId: command.pluginId,
          consecutiveFailures: 0,
          circuitState: "closed",
          circuitOpenedUntil: null,
          queueDepth: current?.queueDepth ?? 0,
          lagMs: current?.lagMs ?? 0,
          lastSuccessAt: current?.lastSuccessAt ?? null,
          lastFailureAt: current?.lastFailureAt ?? null,
          lastError: null,
          updatedAt: command.createdAt,
        },
      });
    }
    case "supervised.signal.acknowledge": {
      const current = state.signals.find((signal) => signal.id === command.signalId);
      const subscription = current
        ? state.subscriptions.find((candidate) => candidate.id === current.subscriptionId)
        : undefined;
      yield* requireHumanOrMatchingSeat(
        command,
        [
          subscription?.ownerLeadSeatId,
          subscription?.destination.kind === "lead_seat"
            ? subscription.destination.leadSeatId
            : null,
        ],
        "Only the Human or receiving Lead may acknowledge this signal.",
      );
      if (!current) return yield* reject(command, "Signal does not exist.");
      yield* requireRevision(command, current.revision);
      if (current.state !== "triggered") return yield* reject(command, "Only triggered signals can be acknowledged.");
      const signal = { ...current, state: "acknowledged" as const, revision: current.revision + 1 };
      return event(command, "supervised.signal-acknowledged", "signal", signal.revision, { signal });
    }
    case "supervised.delivery.redrive": {
      const letter = state.deadLetters.find((candidate) => candidate.id === command.deadLetterId);
      const subscription = letter
        ? state.subscriptions.find((candidate) => candidate.id === letter.subscriptionId)
        : undefined;
      yield* requireHumanOrMatchingSeat(
        command,
        [subscription?.ownerLeadSeatId],
        "Only the Human or owning Lead may redrive this delivery.",
      );
      if (!letter) return yield* reject(command, "DeadLetter does not exist.");
      const current = state.deliveries.find((delivery) => delivery.id === letter.deliveryId);
      if (!current) return yield* reject(command, "DeadLetter delivery does not exist.");
      yield* requireRevision(command, current.attemptCount);
      const delivery = {
        ...current,
        status: "queued" as const,
        availableAt: command.createdAt,
        lastError: null,
        replay: true,
        updatedAt: command.createdAt,
      };
      const deadLetter = {
        ...letter,
        status: "redriving" as const,
        updatedAt: command.createdAt,
      };
      return event(command, "supervised.delivery-updated", "subscription", current.attemptCount, {
        delivery,
        deadLetter,
        metadata: { deadLetterId: letter.id, replayBehavior: command.replayBehavior },
      });
    }
      case "supervised.context.append": {
        yield* requireHumanOrMatchingSeat(
        command,
        [command.record.createdBy.seatId],
          "Only the Human or record author may append this context.",
        );
        const workspace = state.contextWorkspaces.find(
          (candidate) => candidate.id === command.record.workspaceId,
        );
        if (!workspace) return yield* reject(command, "Context Workspace does not exist.");
        yield* requireRevision(command, workspace.revision);
        if (
          state.contextRecords.some(
            (record) =>
              record.id === command.record.id &&
              record.contentRevision >= command.record.contentRevision,
          )
        ) {
          return yield* reject(command, "ContextRecord revision is not newer than the durable record.");
        }
        const contextWorkspace = {
          ...workspace,
          revision: workspace.revision + 1,
          updatedAt: command.createdAt,
        };
        return event(command, "supervised.context-appended", "context_workspace", contextWorkspace.revision, {
          contextWorkspace,
          contextRecord: command.record,
        });
      }
      case "supervised.rlm.upsert": {
        const run = state.runs.find((candidate) => candidate.id === command.episode.runId);
        if (command.actor.kind !== "daemon") {
          yield* requireHumanOrMatchingSeat(
            command,
            [run?.ownerSeatId],
            "Only the Human, daemon, or Run owner may update an RLM episode.",
          );
        }
        if (!run) return yield* reject(command, "RLM episode Run does not exist.");
        const current = state.rlmEpisodes.find((episode) => episode.id === command.episode.id);
        yield* requireRevision(command, current ? current.completedBranchCount : null);
        return event(command, "supervised.rlm-upserted", "rlm_episode", command.episode.completedBranchCount, {
          rlmEpisode: command.episode,
        });
      }
      case "supervised.model-session.upsert": {
          const trace = command.modelSession;
          const run = state.runs.find((candidate) => candidate.id === trace.runId);
          if (command.actor.kind !== "daemon") {
            yield* requireHumanOrMatchingSeat(
              command,
              [run?.ownerSeatId],
              "Only the Human, daemon, or Run owner may record a model session.",
            );
          }
          if (!run) return yield* reject(command, "Model session Run does not exist.");
          if (run.roomId !== trace.roomId || run.taskId !== trace.taskId) {
            return yield* reject(command, "Model session scope does not match its Run.");
          }
          if (trace.taskNodeId !== run.taskNodeId) {
            return yield* reject(command, "Model session TaskNode does not match its Run.");
          }
          if (
            trace.rlmEpisodeId &&
            !state.rlmEpisodes.some(
              (episode) => episode.id === trace.rlmEpisodeId && episode.runId === trace.runId,
            )
          ) {
            return yield* reject(command, "Model session RLM episode does not belong to its Run.");
          }
          if (
            trace.parentSessionId &&
            !state.modelSessions.some(
              (session) => session.id === trace.parentSessionId && session.roomId === trace.roomId,
            )
          ) {
            return yield* reject(command, "Model session parent does not belong to this Room.");
          }
          const current = state.modelSessions.find((session) => session.id === trace.id);
          yield* requireRevision(command, current?.revision ?? null);
          const revision = current ? current.revision + 1 : trace.revision;
          return event(
            command,
            "supervised.model-session-upserted",
            "model_session",
            revision,
            { modelSession: { ...trace, revision, updatedAt: command.createdAt } },
          );
      }
      case "supervised.patch.upsert": {
        yield* requireHuman(command, "Only the Human may activate or replace Harness Patches.");
        const current = state.harnessPatches.find((patch) => patch.id === command.patch.id);
        yield* requireRevision(command, current?.version ?? null);
        if (current && command.patch.version <= current.version) {
          return yield* reject(command, "Harness Patch version must increase.");
        }
        return event(command, "supervised.patch-upserted", "harness_patch", command.patch.version, {
          patch: command.patch,
        });
      }
      case "supervised.specialist.upsert": {
        yield* requireHuman(command, "Only the Human may retain or restore specialists.");
        const current = state.specialists.find(
          (specialist) => specialist.id === command.specialist.id,
        );
        yield* requireRevision(command, current?.revision ?? null);
        if (command.snapshot && !command.snapshot.sanitized) {
          return yield* reject(command, "A retained SpecialistSnapshot must be sanitized.");
        }
        const revision = current ? current.revision + 1 : command.specialist.revision;
        return event(command, "supervised.specialist-upserted", "specialist", command.specialist.revision, {
          specialist: { ...command.specialist, revision, updatedAt: command.createdAt },
          specialistSnapshot: command.snapshot,
        });
      }
      case "supervised.kernel.session-upsert": {
        const run = state.runs.find((candidate) => candidate.id === command.session.runId);
        if (command.actor.kind !== "daemon") {
          yield* requireHumanOrMatchingSeat(
            command,
            [run?.ownerSeatId],
            "Only the Human, daemon, or Run owner may update a KernelSession.",
          );
        }
        if (!run) return yield* reject(command, "KernelSession Run does not exist.");
        const current = state.kernelSessions.find((session) => session.id === command.session.id);
        yield* requireRevision(command, current ? 1 : null);
        return event(command, "supervised.kernel-session-upserted", "kernel_session", current ? 1 : 0, {
          kernelSession: command.session,
        });
      }
      case "supervised.kernel.execution-upsert": {
        const session = state.kernelSessions.find(
          (candidate) => candidate.id === command.execution.kernelSessionId,
        );
        const run = session
          ? state.runs.find((candidate) => candidate.id === session.runId)
          : undefined;
        if (command.actor.kind !== "daemon" && command.actor.kind !== "kernel") {
          yield* requireHumanOrMatchingSeat(
            command,
            [run?.ownerSeatId],
            "Only the Human, daemon, kernel, or Run owner may update a KernelExecution.",
          );
        }
        if (!session) return yield* reject(command, "KernelExecution session does not exist.");
        const current = state.kernelExecutions.find(
          (execution) => execution.id === command.execution.id,
        );
        yield* requireRevision(command, current ? 1 : null);
        return event(command, "supervised.kernel-execution-upserted", "kernel_session", current ? 1 : 0, {
          kernelExecution: command.execution,
        });
      }
      case "supervised.intervention.propose": {
        if (
          command.intervention.requestedBy.kind !== command.actor.kind ||
          command.intervention.requestedBy.actorId !== command.actor.actorId ||
          command.intervention.requestedBy.seatId !== command.actor.seatId
        ) {
          return yield* reject(command, "Intervention requester must match the command actor.");
        }
        yield* requireHumanOrMatchingSeat(
          command,
          [command.intervention.requestedBy.seatId],
          "Only the Human or requesting Lead may propose this intervention.",
        );
        const room = state.rooms.find((candidate) => candidate.id === command.intervention.roomId);
        if (!room) return yield* reject(command, "Intervention Room does not exist.");
        if (state.interventions.some((candidate) => candidate.id === command.intervention.id)) {
          return yield* reject(command, "Intervention already exists.");
        }
        if (
          command.leadNotification.interventionId !== command.intervention.id ||
          command.reconciliation.interventionId !== command.intervention.id ||
          command.leadNotification.roomId !== command.intervention.roomId ||
          command.reconciliation.roomId !== command.intervention.roomId ||
          command.leadNotification.leadSeatId !== room.leadSeatId ||
          command.reconciliation.leadSeatId !== room.leadSeatId
        ) {
          return yield* reject(command, "Intervention notification and reconciliation must target the current Room Lead.");
        }
        yield* requireRevision(command, null);
        return event(command, "supervised.intervention-proposed", "intervention", command.intervention.revision, {
          intervention: command.intervention,
          leadNotification: command.leadNotification,
          reconciliation: command.reconciliation,
        });
      }
      case "supervised.intervention.reconcile": {
        const current = state.interventions.find(
          (candidate) => candidate.id === command.reconciliation.interventionId,
        );
        yield* requireHumanOrMatchingSeat(
          command,
          [command.reconciliation.leadSeatId],
          "Only the Human or current Room Lead may reconcile an intervention.",
        );
        if (!current) return yield* reject(command, "Intervention does not exist.");
        if (current.status !== "open") return yield* reject(command, "Intervention is already closed.");
        yield* requireRevision(command, current.revision);
        const reconciliation = {
          ...command.reconciliation,
          revision: command.reconciliation.revision + 1,
          resolvedAt: command.createdAt,
        };
        const intervention = {
          ...current,
          status: reconciliation.status === "rejected" ? "rejected" as const : "reconciled" as const,
          updatedAt: command.createdAt,
          revision: current.revision + 1,
        };
        return event(command, "supervised.intervention-reconciled", "intervention", intervention.revision, {
          intervention,
          reconciliation,
        });
      }
    case "supervised.compaction.request":
      yield* requireHumanOrMatchingSeat(
        command,
        [
          command.leadSeatId,
          ...state.subscriptions
            .filter(
              (subscription) =>
                subscription.concern === "context" &&
                subscription.scope.some(
                  (scope) => scope.kind === "global" ||
                    (scope.kind === "room" && scope.roomId === command.roomId),
                ),
            )
            .map((subscription) => subscription.ownerLeadSeatId),
        ],
        "Only the Human, Room Lead, or scoped Context Lead may request compaction.",
      );
      return event(command, "supervised.compaction-requested", "supervised_room", command.expectedRevision, {
        metadata: { leadSeatId: command.leadSeatId, roomId: command.roomId, reason: command.reason },
      });
    case "supervised.handoff.request":
      yield* requireHumanOrMatchingSeat(
        command,
        [command.fromSeatId],
        "Only the Human or source seat may request this handoff.",
      );
      return event(command, "supervised.handoff-requested", "supervised_room", command.expectedRevision, {
        metadata: { fromSeatId: command.fromSeatId, roomId: command.roomId, reason: command.reason },
      });
  }
});
