import { createHash } from "node:crypto";

import {
  AgentProfileId,
  AgentSeatId,
  EffectiveAuthorityReceiptId,
  GovernanceHandoffId,
  LeadSeatId,
  RoleAssumptionId,
  RootAuthorityLeaseId,
  SupervisedWorkspaceId,
  SupervisorSeatId,
  ThreadId,
  type AgentSeat,
  type EffectiveAuthorityReceipt,
  type GovernanceHandoff,
  type LeadSeat,
  type RoleAssumption,
  type RootAuthorityLease,
  type SupervisedGovernanceSnapshot,
  type SupervisedRuntimeSnapshot,
  type SupervisorSeat,
} from "@veylen/contracts";

import {
  defaultSupervisedCommandsForRole,
  defaultSupervisedToolsForRole,
} from "../tools/Registry.ts";
import type { SupervisedGovernanceDecisionState } from "../../orchestration/supervised/governanceState.ts";

const workspaceId = SupervisedWorkspaceId.makeUnsafe("workspace:default");
const liveRootStatuses = new Set(["active", "transferring", "releasing"]);

const upsert = <T extends { readonly id: string }>(items: ReadonlyArray<T>, value: T) => {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) return [...items, value];
  if (JSON.stringify(items[index]) === JSON.stringify(value)) return items;
  const next = items.slice();
  next[index] = value;
  return next;
};

const mapChanged = <T>(items: ReadonlyArray<T>, map: (item: T) => T) => {
  let changed = false;
  const next = items.map((item) => {
    const mapped = map(item);
    if (mapped !== item) changed = true;
    return mapped;
  });
  return changed ? next : items;
};

export type GovernanceProjectionSource = "canonical" | "legacy";

const isManagedProjectionReceipt = (receiptId: string) =>
  receiptId.startsWith("legacy-receipt:") || receiptId.startsWith("supervised-projection-receipt:");

const projectionReceiptId = (input: {
  readonly seatId: string;
  readonly role: "supervisor" | "lead" | "peer";
  readonly roomIds: ReadonlyArray<string>;
  readonly rootLeaseIds: ReadonlyArray<string>;
  readonly allowedCommands: ReadonlyArray<string>;
  readonly allowedTools: ReadonlyArray<string>;
  readonly source: GovernanceProjectionSource;
}) => {
  const version = createHash("sha256")
    .update(
      JSON.stringify({
        role: input.role,
        roomIds: [...input.roomIds].sort(),
        rootLeaseIds: [...input.rootLeaseIds].sort(),
        allowedCommands: input.allowedCommands,
        allowedTools: input.allowedTools,
      }),
    )
    .digest("hex")
    .slice(0, 16);
  const prefix = input.source === "legacy" ? "legacy-receipt" : "supervised-projection-receipt";
  return EffectiveAuthorityReceiptId.makeUnsafe(`${prefix}:${input.seatId}:${version}`);
};

const seatLifecycle = (status: string): AgentSeat["lifecycleState"] => {
  if (status === "active") return "active";
  if (status === "queued" || status === "vacant") return "requested";
  if (status === "rotating") return "draining";
  return "retired";
};

const supervisorStatus = (seat: AgentSeat): SupervisorSeat["status"] => {
  if (seat.lifecycleState === "draining") return "rotating";
  if (seat.lifecycleState === "ready" || seat.lifecycleState === "active") return "active";
  if (["requested", "provisioning", "bootstrapping", "recovering"].includes(seat.lifecycleState)) {
    return "queued";
  }
  return "archived";
};

const leadStatus = (seat: AgentSeat): LeadSeat["status"] => {
  if (seat.lifecycleState === "draining") return "rotating";
  if (seat.lifecycleState === "ready" || seat.lifecycleState === "active") return "active";
  if (["requested", "provisioning", "bootstrapping", "recovering"].includes(seat.lifecycleState)) {
    return "vacant";
  }
  return "archived";
};

export function governanceDecisionStateFromSnapshot(input: {
  readonly governance: SupervisedGovernanceSnapshot;
  readonly runtime: SupervisedRuntimeSnapshot;
}): SupervisedGovernanceDecisionState {
  const supervisors = input.governance.agentSeats.flatMap((seat) =>
    seat.identityRole === "supervisor" && seat.threadId != null && seat.profileSnapshotId != null
      ? [
          {
            id: SupervisorSeatId.makeUnsafe(seat.id),
            name: seat.displayName ?? "Supervisor",
            ...(seat.concern === undefined ? {} : { concern: seat.concern }),
            ...(seat.concern === "primary" ? { isPrimary: true } : {}),
            activeThreadId: seat.threadId,
            predecessorThreadIds: seat.predecessorThreadIds ?? [],
            profileSnapshotId: seat.profileSnapshotId,
            status: supervisorStatus(seat),
            createdAt: seat.createdAt,
            updatedAt: seat.updatedAt,
            archivedAt: seat.retiredAt,
            revision: seat.revision,
          },
        ]
      : [],
  );
  const leads = input.governance.agentSeats.flatMap((seat) =>
    seat.identityRole === "lead" &&
    seat.threadId != null &&
    seat.projectId != null &&
    seat.profileSnapshotId != null
      ? [
          {
            id: LeadSeatId.makeUnsafe(seat.id),
            projectId: seat.projectId,
            activeThreadId: seat.threadId,
            predecessorThreadIds: seat.predecessorThreadIds ?? [],
            profileSnapshotId: seat.profileSnapshotId,
            status: leadStatus(seat),
            createdAt: seat.createdAt,
            updatedAt: seat.updatedAt,
            archivedAt: seat.retiredAt,
            revision: seat.revision,
          },
        ]
      : [],
  );
  const peers = input.governance.agentSeats.flatMap((seat) => {
    if (
      seat.identityRole !== "peer" ||
      seat.threadId == null ||
      seat.projectId == null ||
      seat.profileSnapshotId == null
    ) {
      return [];
    }
    const room = input.runtime.rooms.find((candidate) => seat.roomIds.includes(candidate.id));
    const lead = room?.leadSeatId
      ? input.governance.agentSeats.find(
          (candidate) => String(candidate.id) === String(room.leadSeatId),
        )
      : undefined;
    if (!room?.leadSeatId || lead?.threadId == null) return [];
    return [
      {
        threadId: seat.threadId,
        projectId: seat.projectId,
        leadSeatId: room.leadSeatId,
        rootThreadId: lead.threadId,
        profileSnapshotId: seat.profileSnapshotId,
        status: seat.lifecycleState === "retired" ? ("archived" as const) : ("active" as const),
        createdAt: seat.createdAt,
        updatedAt: seat.updatedAt,
        archivedAt: seat.retiredAt,
        revision: seat.revision,
      },
    ];
  });
  const orchestration = input.governance.orchestration;
  return {
    revision: orchestration.revision,
    profiles: orchestration.profiles,
    profileSnapshots: orchestration.profileSnapshots,
    supervisors,
    leads,
    peers,
    missions: orchestration.missions,
    workflowDirectives: orchestration.workflowDirectives,
    workflowConflicts: orchestration.workflowConflicts,
    advice: orchestration.advice,
    observationCursors: orchestration.observationCursors,
    wakeQueue: orchestration.wakeQueue,
    rotations: orchestration.rotations,
    updatedAt: orchestration.updatedAt,
  };
}

const roomIdsForLead = (runtime: SupervisedRuntimeSnapshot, leadSeatId: string) =>
  runtime.rooms.filter((room) => room.leadSeatId === leadSeatId).map((room) => room.id);

const roomIdsForSupervisor = (
  runtime: SupervisedRuntimeSnapshot,
  state: SupervisedGovernanceDecisionState,
  supervisorSeatId: string,
) => {
  const missions = state.missions.filter(
    (mission) => mission.supervisorSeatId === supervisorSeatId && mission.status === "active",
  );
  return runtime.rooms
    .filter(
      (room) =>
        room.leadSeatId === supervisorSeatId ||
        missions.some((mission) =>
          mission.scope.some((scope) => {
            if (scope.kind === "all_projects") return true;
            if (scope.kind === "project") return scope.projectId === room.projectId;
            if (scope.kind === "lead") return scope.leadSeatId === room.leadSeatId;
            return false;
          }),
        ),
    )
    .map((room) => room.id);
};

const isManagedProjectionLease = (leaseId: string) =>
  leaseId.startsWith("legacy-root-lease:") ||
  leaseId.startsWith("supervised-projection-root-lease:");

const activeProjectionLeaseFor = (
  snapshot: SupervisedGovernanceSnapshot,
  roomId: string,
  holderSeatId: string,
) =>
  snapshot.rootLeases.find(
    (lease) =>
      lease.roomId === roomId &&
      lease.holderSeatId === holderSeatId &&
      liveRootStatuses.has(lease.status) &&
      isManagedProjectionLease(lease.id),
  );

const rootLeaseIdFor = (
  snapshot: SupervisedGovernanceSnapshot,
  roomId: string,
  holderSeatId: string,
  source: GovernanceProjectionSource,
) =>
  activeProjectionLeaseFor(snapshot, roomId, holderSeatId)?.id ??
  RootAuthorityLeaseId.makeUnsafe(
    `${source === "legacy" ? "legacy-root-lease" : "supervised-projection-root-lease"}:${roomId}:${holderSeatId}`,
  );

const makeReceipt = (input: {
  readonly snapshot: SupervisedGovernanceSnapshot;
  readonly seatId: string;
  readonly role: "supervisor" | "lead" | "peer";
  readonly roomIds: ReadonlyArray<string>;
  readonly rootRoomIds: ReadonlyArray<string>;
  readonly issuedAt: string;
  readonly at: string;
  readonly source: GovernanceProjectionSource;
}): EffectiveAuthorityReceipt => {
  const currentSeat = input.snapshot.agentSeats.find((seat) => seat.id === input.seatId);
  const currentReceipt = input.snapshot.authorityReceipts.find(
    (receipt) => receipt.id === currentSeat?.authorityReceiptId,
  );
  if (
    currentReceipt !== undefined &&
    isManagedProjectionReceipt(currentReceipt.id) &&
    (currentReceipt.revokedAt !== null ||
      (currentReceipt.expiresAt !== null && currentReceipt.expiresAt <= input.at))
  ) {
    return currentReceipt;
  }

  const rootLeaseIds = input.rootRoomIds.map((roomId) =>
    rootLeaseIdFor(input.snapshot, roomId, input.seatId, input.source),
  );
  const actingRoot = input.role === "supervisor" && rootLeaseIds.length > 0;
  const leadCommands = [
    "supervised.peer.create",
    "supervised.work.assign",
    "supervised.intervention.reconcile",
    "supervised.room.update",
    "supervised.task.create",
    "supervised.task-node.commit",
    "supervised.task-graph.create",
    "supervised.task.delegate",
    "supervised.run.request",
    "supervised.run.transition",
    "supervised.review.accept",
    "supervised.context.workspace-upsert",
    "supervised.context.append",
    "supervised.rlm.upsert",
    "supervised.model-session.upsert",
    "supervised.evidence.publish",
  ] as const;
  const supervisorCommands = [
    "supervised.room.create",
    "supervised.lead.create",
    "supervised.role.assume",
    "supervised.peer.create",
    "supervised.work.assign",
    "supervised.context.workspace-upsert",
    "supervised.context.append",
    "supervised.rlm.upsert",
    "supervised.model-session.upsert",
    "supervised.evidence.publish",
  ] as const;
  const allowedCommands = [
    ...(input.role === "lead"
      ? leadCommands
      : input.role === "supervisor"
        ? actingRoot
          ? [...supervisorCommands, ...leadCommands]
          : supervisorCommands
        : [
            "supervised.work.complete",
            "supervised.run.start",
            "supervised.run.submit",
            "supervised.claim.acquire",
            "supervised.claim.release",
            "supervised.run.transition",
            "supervised.task-node.commit",
            "supervised.evidence.publish",
          ]),
    ...defaultSupervisedCommandsForRole(input.role),
    ...(actingRoot ? defaultSupervisedCommandsForRole("lead") : []),
  ];
  const allowedTools = [
    ...defaultSupervisedToolsForRole(input.role),
    ...(actingRoot ? defaultSupervisedToolsForRole("lead") : []),
  ];
  return {
    id: projectionReceiptId({
      seatId: input.seatId,
      role: input.role,
      roomIds: input.roomIds,
      rootLeaseIds,
      allowedCommands,
      allowedTools,
      source:
        currentReceipt?.id.startsWith("supervised-projection-receipt:") === true
          ? "canonical"
          : input.source,
    }),
    actorSeatId: AgentSeatId.makeUnsafe(input.seatId),
    identityRole: input.role,
    effectiveRole: actingRoot ? "acting_root" : input.role,
    workspaceScopes: [workspaceId],
    roomScopes: input.roomIds as EffectiveAuthorityReceipt["roomScopes"],
    taskNodeScopes: [],
    allowedCommands,
    allowedTools,
    rootLeaseIds,
    mandateIds: [],
    runPolicyRevision: 0,
    issuedAt: input.issuedAt,
    expiresAt: null,
    revokedAt: null,
  };
};

const shouldPreserveExternallyManagedSeat = (
  snapshot: SupervisedGovernanceSnapshot,
  seatId: string,
) => {
  const current = snapshot.agentSeats.find((seat) => seat.id === seatId);
  return current !== undefined && !isManagedProjectionReceipt(current.authorityReceiptId);
};

export function reconcileGovernanceProjection(input: {
  readonly governance: SupervisedGovernanceSnapshot;
  readonly state: SupervisedGovernanceDecisionState;
  readonly runtime: SupervisedRuntimeSnapshot;
  readonly at: string;
  readonly source: GovernanceProjectionSource;
}): SupervisedGovernanceSnapshot {
  let authorityReceipts = input.governance.authorityReceipts;
  let agentSeats = input.governance.agentSeats;
  let rootLeases = input.governance.rootLeases;
  let handoffs = input.governance.handoffs;
  let roleAssumptions = input.governance.roleAssumptions;

  for (const supervisor of input.state.supervisors) {
    if (shouldPreserveExternallyManagedSeat(input.governance, supervisor.id)) continue;
    const roomIds = roomIdsForSupervisor(input.runtime, input.state, supervisor.id);
    const rootRoomIds = roomIdsForLead(input.runtime, supervisor.id);
    const receipt = makeReceipt({
      snapshot: input.governance,
      seatId: supervisor.id,
      role: "supervisor",
      roomIds,
      rootRoomIds,
      issuedAt: supervisor.createdAt,
      at: input.at,
      source: input.source,
    });
    authorityReceipts = upsert(authorityReceipts, receipt);
    agentSeats = upsert(agentSeats, {
      id: AgentSeatId.makeUnsafe(supervisor.id),
      workspaceId,
      roomIds,
      identityRole: "supervisor",
      effectiveRole: receipt.effectiveRole,
      profileId: AgentProfileId.makeUnsafe(supervisor.profileSnapshotId),
      ...((supervisor.isPrimary ?? false)
        ? { concern: "primary" }
        : supervisor.concern === undefined
          ? {}
          : { concern: supervisor.concern }),
      providerSessionId: null,
      lifecycleState: seatLifecycle(supervisor.status),
      workState: "idle",
      authorityReceiptId: receipt.id,
      threadId: supervisor.activeThreadId,
      projectId: null,
      profileSnapshotId: supervisor.profileSnapshotId,
      predecessorThreadIds: supervisor.predecessorThreadIds,
      displayName: supervisor.name,
      createdAt: supervisor.createdAt,
      retainedAt: null,
      retiredAt: supervisor.archivedAt,
      revision: supervisor.revision,
      updatedAt: supervisor.updatedAt,
    });
  }

  for (const lead of input.state.leads) {
    if (shouldPreserveExternallyManagedSeat(input.governance, lead.id)) continue;
    const roomIds = roomIdsForLead(input.runtime, lead.id);
    const receipt = makeReceipt({
      snapshot: input.governance,
      seatId: lead.id,
      role: "lead",
      roomIds,
      rootRoomIds: roomIds,
      issuedAt: lead.createdAt,
      at: input.at,
      source: input.source,
    });
    authorityReceipts = upsert(authorityReceipts, receipt);
    agentSeats = upsert(agentSeats, {
      id: AgentSeatId.makeUnsafe(lead.id),
      workspaceId,
      roomIds,
      identityRole: "lead",
      effectiveRole: "lead",
      profileId: AgentProfileId.makeUnsafe(lead.profileSnapshotId),
      providerSessionId: null,
      lifecycleState: seatLifecycle(lead.status),
      workState: "idle",
      authorityReceiptId: receipt.id,
      threadId: lead.activeThreadId,
      projectId: lead.projectId,
      profileSnapshotId: lead.profileSnapshotId,
      predecessorThreadIds: lead.predecessorThreadIds,
      displayName: null,
      createdAt: lead.createdAt,
      retainedAt: null,
      retiredAt: lead.archivedAt,
      revision: lead.revision,
      updatedAt: lead.updatedAt,
    });
  }

  for (const peer of input.state.peers) {
    if (shouldPreserveExternallyManagedSeat(input.governance, peer.threadId)) continue;
    const roomIds = roomIdsForLead(input.runtime, peer.leadSeatId);
    const receipt = makeReceipt({
      snapshot: input.governance,
      seatId: peer.threadId,
      role: "peer",
      roomIds,
      rootRoomIds: [],
      issuedAt: peer.createdAt,
      at: input.at,
      source: input.source,
    });
    authorityReceipts = upsert(authorityReceipts, receipt);
    agentSeats = upsert(agentSeats, {
      id: AgentSeatId.makeUnsafe(peer.threadId),
      workspaceId,
      roomIds,
      identityRole: "peer",
      effectiveRole: "peer",
      profileId: AgentProfileId.makeUnsafe(peer.profileSnapshotId),
      providerSessionId: null,
      lifecycleState: seatLifecycle(peer.status),
      workState: "idle",
      authorityReceiptId: receipt.id,
      threadId: peer.threadId,
      projectId: peer.projectId,
      profileSnapshotId: peer.profileSnapshotId,
      predecessorThreadIds: [],
      displayName: null,
      createdAt: peer.createdAt,
      retainedAt: null,
      retiredAt: peer.archivedAt,
      revision: peer.revision,
      updatedAt: peer.updatedAt,
    });
  }

  for (const room of input.runtime.rooms) {
    if (
      room.leadSeatId === null ||
      agentSeats.some((seat) => String(seat.id) === String(room.leadSeatId))
    ) {
      continue;
    }
    const leadRooms = input.runtime.rooms.filter(
      (candidate) => candidate.leadSeatId === room.leadSeatId,
    );
    const createdAt = leadRooms.reduce(
      (earliest, candidate) => (candidate.createdAt < earliest ? candidate.createdAt : earliest),
      room.createdAt,
    );
    const updatedAt = leadRooms.reduce(
      (latest, candidate) => (candidate.updatedAt > latest ? candidate.updatedAt : latest),
      room.updatedAt,
    );
    const retired = leadRooms.every(
      (candidate) => candidate.status === "completed" || candidate.status === "archived",
    );
    const receipt = makeReceipt({
      snapshot: { ...input.governance, rootLeases },
      seatId: room.leadSeatId,
      role: "lead",
      roomIds: leadRooms.map((candidate) => candidate.id),
      rootRoomIds: leadRooms.map((candidate) => candidate.id),
      issuedAt: createdAt,
      at: input.at,
      source: input.source,
    });
    authorityReceipts = upsert(authorityReceipts, receipt);
    agentSeats = upsert(agentSeats, {
      id: AgentSeatId.makeUnsafe(room.leadSeatId),
      workspaceId,
      roomIds: leadRooms.map((candidate) => candidate.id),
      identityRole: "lead",
      effectiveRole: "lead",
      profileId: AgentProfileId.makeUnsafe(`${room.leadSeatId}:initial-profile`),
      providerSessionId: null,
      lifecycleState: retired ? "retired" : "active",
      workState: "idle",
      authorityReceiptId: receipt.id,
      threadId: ThreadId.makeUnsafe(room.id),
      projectId: room.projectId,
      profileSnapshotId: null,
      predecessorThreadIds: [],
      displayName: null,
      createdAt,
      retainedAt: null,
      retiredAt: retired ? updatedAt : null,
      revision: Math.max(...leadRooms.map((candidate) => candidate.revision)),
      updatedAt,
    });
  }

  for (const room of input.runtime.rooms) {
    if (room.leadSeatId === null) continue;
    const externallyManagedLiveLease = rootLeases.find(
      (lease) =>
        lease.roomId === room.id &&
        liveRootStatuses.has(lease.status) &&
        !isManagedProjectionLease(lease.id),
    );
    if (externallyManagedLiveLease) continue;
    const holderSeat = agentSeats.find((seat) => String(seat.id) === String(room.leadSeatId));
    if (!holderSeat) {
      throw new Error(`Lead Room '${room.id}' references missing Lead seat '${room.leadSeatId}'.`);
    }
    const holderReceipt = authorityReceipts.find(
      (receipt) => receipt.id === holderSeat.authorityReceiptId,
    );
    if (
      !holderReceipt ||
      holderReceipt.revokedAt !== null ||
      (holderReceipt.expiresAt !== null && holderReceipt.expiresAt <= input.at)
    ) {
      rootLeases = mapChanged(rootLeases, (lease) =>
        lease.roomId === room.id &&
        String(lease.holderSeatId) === String(room.leadSeatId) &&
        liveRootStatuses.has(lease.status) &&
        isManagedProjectionLease(lease.id)
          ? {
              ...lease,
              status: "released" as const,
              releasedAt: input.at,
              revision: lease.revision + 1,
              updatedAt: input.at,
            }
          : lease,
      );
      continue;
    }
    const previousRootLease = rootLeases.find(
      (lease) =>
        lease.roomId === room.id &&
        String(lease.holderSeatId) !== String(room.leadSeatId) &&
        liveRootStatuses.has(lease.status) &&
        isManagedProjectionLease(lease.id),
    );
    const current = activeProjectionLeaseFor(
      { ...input.governance, rootLeases },
      room.id,
      room.leadSeatId,
    );
    rootLeases = mapChanged(rootLeases, (lease) =>
      lease.roomId === room.id &&
      String(lease.holderSeatId) !== String(room.leadSeatId) &&
      liveRootStatuses.has(lease.status) &&
      isManagedProjectionLease(lease.id)
        ? {
            ...lease,
            status: "released" as const,
            releasedAt: input.at,
            revision: lease.revision + 1,
            updatedAt: input.at,
          }
        : lease,
    );
    const terminal = room.status === "completed" || room.status === "archived";
    const lease: RootAuthorityLease = {
      id: current?.id ?? rootLeaseIdFor(input.governance, room.id, room.leadSeatId, input.source),
      workspaceId,
      roomId: room.id,
      holderSeatId: AgentSeatId.makeUnsafe(room.leadSeatId),
      status: terminal ? "released" : "active",
      acquiredUnderReceiptId: current?.acquiredUnderReceiptId ?? holderSeat.authorityReceiptId,
      predecessorLeaseId: previousRootLease?.id ?? current?.predecessorLeaseId ?? null,
      acquiredAt: current?.acquiredAt ?? (previousRootLease ? input.at : room.createdAt),
      releasedAt: terminal ? room.updatedAt : null,
      expiresAt: null,
      revision: room.revision,
      updatedAt: room.updatedAt,
    };
    rootLeases = upsert(rootLeases, lease);
    if (previousRootLease && holderSeat.identityRole === "supervisor") {
      const transferKey = `${room.id}:${previousRootLease.holderSeatId}:${holderSeat.id}:${room.revision}`;
      const handoffId = GovernanceHandoffId.makeUnsafe(
        `governance-handoff:role-assume:${transferKey}`,
      );
      const handoff: GovernanceHandoff = {
        id: handoffId,
        workspaceId,
        roomId: room.id,
        fromSeatId: previousRootLease.holderSeatId,
        toSeatId: holderSeat.id,
        lifecycleState: "reconciled",
        scope: [{ kind: "room", roomId: room.id }],
        summary:
          "The authenticated owner directed the Supervisor to assume Root. The former Root was notified to publish a durable checkpoint and handoff summary.",
        evidenceRefs: [],
        preparedAt: input.at,
        acceptedAt: input.at,
        transferredAt: input.at,
        reconciledAt: input.at,
        revision: 0,
        updatedAt: input.at,
      };
      const roleAssumption: RoleAssumption = {
        id: RoleAssumptionId.makeUnsafe(`role-assumption:${transferKey}`),
        workspaceId,
        roomId: room.id,
        actorSeatId: holderSeat.id,
        previousRootSeatId: previousRootLease.holderSeatId,
        handoffId,
        previousLeaseId: previousRootLease.id,
        nextLeaseId: lease.id,
        operation: "assume",
        lifecycleState: "active",
        requestedUnderReceiptId: holderReceipt.id,
        failureReason: null,
        createdAt: input.at,
        completedAt: input.at,
        revision: 0,
        updatedAt: input.at,
      };
      handoffs = upsert(handoffs, handoff);
      roleAssumptions = upsert(roleAssumptions, roleAssumption);
    }
  }

  const workspaces = input.governance.workspaces.some((workspace) => workspace.id === workspaceId)
    ? input.governance.workspaces
    : [
        ...input.governance.workspaces,
        {
          id: workspaceId,
          ownerNamespace: "local",
          title: "Local Supervised Workspace",
          lifecycleState: "active" as const,
          revision: 0,
          createdAt: input.at,
          updatedAt: input.at,
        },
      ];

  if (
    workspaces === input.governance.workspaces &&
    authorityReceipts === input.governance.authorityReceipts &&
    agentSeats === input.governance.agentSeats &&
    rootLeases === input.governance.rootLeases &&
    handoffs === input.governance.handoffs &&
    roleAssumptions === input.governance.roleAssumptions
  ) {
    return input.governance;
  }

  return {
    ...input.governance,
    workspaces,
    authorityReceipts,
    agentSeats,
    rootLeases,
    handoffs,
    roleAssumptions,
    updatedAt: input.at,
  };
}
