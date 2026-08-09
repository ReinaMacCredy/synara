import { createHash } from "node:crypto";

import {
  AgentProfileId,
  AgentSeatId,
  EffectiveAuthorityReceiptId,
  RootAuthorityLeaseId,
  SupervisedWorkspaceId,
  type AgentSeat,
  type EffectiveAuthorityReceipt,
  type RootAuthorityLease,
  type SupervisedGovernanceSnapshot,
  type SupervisedRuntimeSnapshot,
  type SupervisionSnapshot,
} from "@synara/contracts";

import {
  defaultSupervisedCommandsForRole,
  defaultSupervisedToolsForRole,
} from "../tools/Registry.ts";

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

const legacyReceiptId = (input: {
  readonly seatId: string;
  readonly role: "supervisor" | "lead" | "peer";
  readonly roomIds: ReadonlyArray<string>;
  readonly rootLeaseIds: ReadonlyArray<string>;
  readonly allowedCommands: ReadonlyArray<string>;
  readonly allowedTools: ReadonlyArray<string>;
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
  return EffectiveAuthorityReceiptId.makeUnsafe(`legacy-receipt:${input.seatId}:${version}`);
};

const seatLifecycle = (status: string): AgentSeat["lifecycleState"] => {
  if (status === "active") return "active";
  if (status === "queued" || status === "vacant") return "requested";
  if (status === "rotating") return "draining";
  return "retired";
};

const roomIdsForLead = (runtime: SupervisedRuntimeSnapshot, leadSeatId: string) =>
  runtime.rooms.filter((room) => room.leadSeatId === leadSeatId).map((room) => room.id);

const activeLegacyLeaseFor = (
  snapshot: SupervisedGovernanceSnapshot,
  roomId: string,
  holderSeatId: string,
) =>
  snapshot.rootLeases.find(
    (lease) =>
      lease.roomId === roomId &&
      lease.holderSeatId === holderSeatId &&
      liveRootStatuses.has(lease.status) &&
      lease.id.startsWith("legacy-root-lease:"),
  );

const rootLeaseIdFor = (
  snapshot: SupervisedGovernanceSnapshot,
  roomId: string,
  holderSeatId: string,
) =>
  activeLegacyLeaseFor(snapshot, roomId, holderSeatId)?.id ??
  RootAuthorityLeaseId.makeUnsafe(`legacy-root-lease:${roomId}:${holderSeatId}`);

const makeReceipt = (input: {
  readonly snapshot: SupervisedGovernanceSnapshot;
  readonly seatId: string;
  readonly role: "supervisor" | "lead" | "peer";
  readonly roomIds: ReadonlyArray<string>;
  readonly issuedAt: string;
  readonly at: string;
}): EffectiveAuthorityReceipt => {
  const currentSeat = input.snapshot.agentSeats.find((seat) => seat.id === input.seatId);
  const currentReceipt = input.snapshot.authorityReceipts.find(
    (receipt) => receipt.id === currentSeat?.authorityReceiptId,
  );
  if (
    currentReceipt?.id.startsWith("legacy-receipt:") &&
    (currentReceipt.revokedAt !== null ||
      (currentReceipt.expiresAt !== null && currentReceipt.expiresAt <= input.at))
  ) {
    return currentReceipt;
  }

  const rootLeaseIds =
    input.role === "lead"
      ? input.roomIds.map((roomId) => rootLeaseIdFor(input.snapshot, roomId, input.seatId))
      : [];
  const allowedCommands = [
    ...(input.role === "lead" ? ["supervised.specialist.create"] : []),
    ...defaultSupervisedCommandsForRole(input.role),
  ];
  const allowedTools = defaultSupervisedToolsForRole(input.role);
  return {
    id: legacyReceiptId({
      seatId: input.seatId,
      role: input.role,
      roomIds: input.roomIds,
      rootLeaseIds,
      allowedCommands,
      allowedTools,
    }),
    actorSeatId: AgentSeatId.makeUnsafe(input.seatId),
    identityRole: input.role,
    effectiveRole: input.role,
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

const shouldPreserveCanonicalSeat = (
  snapshot: SupervisedGovernanceSnapshot,
  seatId: string,
) => {
  const current = snapshot.agentSeats.find((seat) => seat.id === seatId);
  return current !== undefined && !current.authorityReceiptId.startsWith("legacy-receipt:");
};

export function reconcileLegacyGovernance(input: {
  readonly governance: SupervisedGovernanceSnapshot;
  readonly supervision: SupervisionSnapshot;
  readonly runtime: SupervisedRuntimeSnapshot;
  readonly at: string;
}): SupervisedGovernanceSnapshot {
  let authorityReceipts = input.governance.authorityReceipts;
  let agentSeats = input.governance.agentSeats;
  let rootLeases = input.governance.rootLeases;

  for (const supervisor of input.supervision.supervisors) {
    if (shouldPreserveCanonicalSeat(input.governance, supervisor.id)) continue;
    const receipt = makeReceipt({
      snapshot: input.governance,
      seatId: supervisor.id,
      role: "supervisor",
      roomIds: [],
      issuedAt: supervisor.createdAt,
      at: input.at,
    });
    authorityReceipts = upsert(authorityReceipts, receipt);
    agentSeats = upsert(agentSeats, {
      id: AgentSeatId.makeUnsafe(supervisor.id),
      workspaceId,
      roomIds: [],
      identityRole: "supervisor",
      effectiveRole: "supervisor",
      profileId: AgentProfileId.makeUnsafe(supervisor.profileSnapshotId),
      providerSessionId: null,
      lifecycleState: seatLifecycle(supervisor.status),
      workState: "idle",
      authorityReceiptId: receipt.id,
      createdAt: supervisor.createdAt,
      retainedAt: null,
      retiredAt: supervisor.archivedAt,
      revision: supervisor.revision,
      updatedAt: supervisor.updatedAt,
    });
  }

  for (const lead of input.supervision.leads) {
    if (shouldPreserveCanonicalSeat(input.governance, lead.id)) continue;
    const roomIds = roomIdsForLead(input.runtime, lead.id);
    const receipt = makeReceipt({
      snapshot: input.governance,
      seatId: lead.id,
      role: "lead",
      roomIds,
      issuedAt: lead.createdAt,
      at: input.at,
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
      createdAt: lead.createdAt,
      retainedAt: null,
      retiredAt: lead.archivedAt,
      revision: lead.revision,
      updatedAt: lead.updatedAt,
    });
  }

  for (const peer of input.supervision.peers) {
    if (shouldPreserveCanonicalSeat(input.governance, peer.threadId)) continue;
    const roomIds = roomIdsForLead(input.runtime, peer.leadSeatId);
    const receipt = makeReceipt({
      snapshot: input.governance,
      seatId: peer.threadId,
      role: "peer",
      roomIds,
      issuedAt: peer.createdAt,
      at: input.at,
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
      createdAt: peer.createdAt,
      retainedAt: null,
      retiredAt: peer.archivedAt,
      revision: peer.revision,
      updatedAt: peer.updatedAt,
    });
  }

  for (const room of input.runtime.rooms) {
    if (room.leadSeatId === null || agentSeats.some((seat) => seat.id === room.leadSeatId)) {
      continue;
    }
    const leadRooms = input.runtime.rooms.filter(
      (candidate) => candidate.leadSeatId === room.leadSeatId,
    );
    const createdAt = leadRooms.reduce(
      (earliest, candidate) =>
        candidate.createdAt < earliest ? candidate.createdAt : earliest,
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
      issuedAt: createdAt,
      at: input.at,
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
      createdAt,
      retainedAt: null,
      retiredAt: retired ? updatedAt : null,
      revision: Math.max(...leadRooms.map((candidate) => candidate.revision)),
      updatedAt,
    });
  }

  for (const room of input.runtime.rooms) {
    if (room.leadSeatId === null) continue;
    const canonicalLiveLease = rootLeases.find(
      (lease) =>
        lease.roomId === room.id &&
        liveRootStatuses.has(lease.status) &&
        !lease.id.startsWith("legacy-root-lease:"),
    );
    if (canonicalLiveLease) continue;
    const holderSeat = agentSeats.find((seat) => seat.id === room.leadSeatId);
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
        lease.holderSeatId === room.leadSeatId &&
        liveRootStatuses.has(lease.status) &&
        lease.id.startsWith("legacy-root-lease:")
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
    const current = activeLegacyLeaseFor(
      { ...input.governance, rootLeases },
      room.id,
      room.leadSeatId,
    );
    rootLeases = mapChanged(rootLeases, (lease) =>
      lease.roomId === room.id &&
      lease.holderSeatId !== room.leadSeatId &&
      liveRootStatuses.has(lease.status) &&
      lease.id.startsWith("legacy-root-lease:")
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
      id: current?.id ?? rootLeaseIdFor(input.governance, room.id, room.leadSeatId),
      workspaceId,
      roomId: room.id,
      holderSeatId: AgentSeatId.makeUnsafe(room.leadSeatId),
      status: terminal ? "released" : "active",
      acquiredUnderReceiptId: current?.acquiredUnderReceiptId ?? holderSeat.authorityReceiptId,
      predecessorLeaseId: null,
      acquiredAt: room.createdAt,
      releasedAt: terminal ? room.updatedAt : null,
      expiresAt: null,
      revision: room.revision,
      updatedAt: room.updatedAt,
    };
    rootLeases = upsert(rootLeases, lease);
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
    rootLeases === input.governance.rootLeases
  ) {
    return input.governance;
  }

  return {
    ...input.governance,
    workspaces,
    authorityReceipts,
    agentSeats,
    rootLeases,
    updatedAt: input.at,
  };
}
