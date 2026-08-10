import type {
  AgentSeat,
  DirectIntervention,
  EffectiveAuthorityReceiptId,
  GovernedProviderSession,
  GovernanceHandoff,
  LeadReplacement,
  RoleAssumption,
  Room,
  RootAuthorityLeaseId,
  SupervisedGovernanceSnapshot,
} from "@synara/contracts";

const liveRootStatuses = new Set(["active", "transferring", "releasing"]);

const roomTransitions: Readonly<Record<Room["status"], ReadonlySet<Room["status"]>>> = {
  draft: new Set(["provisioning"]),
  provisioning: new Set(["ready", "failed"]),
  ready: new Set(["active"]),
  active: new Set(["paused", "degraded"]),
  paused: new Set(["active", "draining"]),
  draining: new Set(["completed"]),
  degraded: new Set(["recovering", "failed"]),
  recovering: new Set(["active", "failed"]),
  completed: new Set(["archived"]),
  archived: new Set(),
  failed: new Set(),
};

const seatTransitions: Readonly<
  Record<AgentSeat["lifecycleState"], ReadonlySet<AgentSeat["lifecycleState"]>>
> = {
  requested: new Set(["provisioning", "failed"]),
  provisioning: new Set(["bootstrapping", "failed"]),
  bootstrapping: new Set(["ready", "failed"]),
  ready: new Set(["active", "failed"]),
  active: new Set(["draining", "lost", "failed"]),
  draining: new Set(["retained", "failed"]),
  retained: new Set(["active", "retired", "lost"]),
  retired: new Set(),
  failed: new Set(["recovering", "retired"]),
  lost: new Set(["recovering", "retired"]),
  recovering: new Set(["ready", "active", "retained", "failed", "retired"]),
};

const providerSessionTransitions: Readonly<
  Record<
    GovernedProviderSession["lifecycleState"],
    ReadonlySet<GovernedProviderSession["lifecycleState"]>
  >
> = {
  creating: new Set(["active", "interrupted", "failed"]),
  active: new Set(["retained", "closing", "interrupted", "lost", "failed"]),
  retained: new Set(["resuming", "closing", "closed", "lost"]),
  resuming: new Set(["active", "interrupted", "lost", "failed"]),
  closing: new Set(["closed", "failed"]),
  closed: new Set(),
  interrupted: new Set(["recovering", "closing", "failed"]),
  lost: new Set(["recovering", "closed", "failed"]),
  recovering: new Set(["active", "retained", "failed", "closed"]),
  failed: new Set(["recovering", "closed"]),
};

const handoffTransitions: Readonly<
  Record<GovernanceHandoff["lifecycleState"], ReadonlySet<GovernanceHandoff["lifecycleState"]>>
> = {
  draft: new Set(["prepared", "cancelled", "failed"]),
  prepared: new Set(["delivered", "expired", "cancelled", "failed"]),
  delivered: new Set(["acknowledged", "rejected", "expired", "failed"]),
  acknowledged: new Set(["accepted", "rejected", "expired", "failed"]),
  accepted: new Set(["ownership_transferred", "failed"]),
  ownership_transferred: new Set(["reconciled", "failed"]),
  reconciled: new Set(),
  rejected: new Set(),
  expired: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

const interventionTransitions: Readonly<
  Record<DirectIntervention["lifecycleState"], ReadonlySet<DirectIntervention["lifecycleState"]>>
> = {
  opened: new Set(["delivered", "failed"]),
  delivered: new Set(["acknowledged", "failed"]),
  acknowledged: new Set(["executing", "failed"]),
  executing: new Set(["completed", "failed"]),
  completed: new Set(["lead_notified", "failed"]),
  lead_notified: new Set(["reconciled", "not_required", "failed"]),
  reconciled: new Set(["closed", "failed"]),
  not_required: new Set(["closed", "failed"]),
  closed: new Set(),
  failed: new Set(),
};

const roleAssumptionTransitions: Readonly<
  Record<RoleAssumption["lifecycleState"], ReadonlySet<RoleAssumption["lifecycleState"]>>
> = {
  requested: new Set(["authority_validated", "failed"]),
  authority_validated: new Set(["destination_ready", "failed"]),
  destination_ready: new Set(["previous_root_notified", "failed"]),
  previous_root_notified: new Set(["lease_transferred", "failed"]),
  lease_transferred: new Set(["topology_reconciled", "released", "failed"]),
  topology_reconciled: new Set(["active", "failed"]),
  active: new Set(["release_requested", "failed"]),
  release_requested: new Set(["successor_ready", "failed"]),
  successor_ready: new Set(["handoff_accepted", "failed"]),
  handoff_accepted: new Set(["lease_transferred", "failed"]),
  released: new Set(),
  failed: new Set(),
};

const leadReplacementTransitions: Readonly<
  Record<LeadReplacement["lifecycleState"], ReadonlySet<LeadReplacement["lifecycleState"]>>
> = {
  requested: new Set(["provisioning_replacement", "failed"]),
  provisioning_replacement: new Set(["replacement_ready", "failed"]),
  replacement_ready: new Set(["handoff_prepared", "failed"]),
  handoff_prepared: new Set(["handoff_accepted", "failed"]),
  handoff_accepted: new Set(["lease_transferred", "failed"]),
  lease_transferred: new Set(["topology_reconciled", "failed"]),
  topology_reconciled: new Set(["draining_previous", "failed"]),
  draining_previous: new Set(["completed", "failed"]),
  completed: new Set(),
  failed: new Set(),
};

const transition = <State extends string>(
  kind: string,
  from: State,
  to: State,
  transitions: Readonly<Record<State, ReadonlySet<State>>>,
) => {
  if (!transitions[from].has(to)) throw new Error(`Illegal ${kind} transition: ${from} -> ${to}.`);
};

export function transitionAgentSeat(
  seat: AgentSeat,
  to: AgentSeat["lifecycleState"],
  at: string,
): AgentSeat {
  transition("AgentSeat", seat.lifecycleState, to, seatTransitions);
  return {
    ...seat,
    lifecycleState: to,
    retainedAt: to === "retained" ? at : seat.retainedAt,
    retiredAt: to === "retired" ? at : seat.retiredAt,
    revision: seat.revision + 1,
    updatedAt: at,
  };
}

export function transitionRoom(room: Room, to: Room["status"], at: string): Room {
  transition("Room", room.status, to, roomTransitions);
  return {
    ...room,
    status: to,
    revision: room.revision + 1,
    updatedAt: at,
  };
}

export function transitionProviderSession(
  session: GovernedProviderSession,
  to: GovernedProviderSession["lifecycleState"],
  at: string,
): GovernedProviderSession {
  transition("ProviderSession", session.lifecycleState, to, providerSessionTransitions);
  return {
    ...session,
    lifecycleState: to,
    retainedAt: to === "retained" ? at : session.retainedAt,
    closedAt: to === "closed" ? at : session.closedAt,
    revision: session.revision + 1,
    updatedAt: at,
  };
}

export function transitionHandoff(
  handoff: GovernanceHandoff,
  to: GovernanceHandoff["lifecycleState"],
  at: string,
): GovernanceHandoff {
  transition("Handoff", handoff.lifecycleState, to, handoffTransitions);
  return {
    ...handoff,
    lifecycleState: to,
    preparedAt: to === "prepared" ? at : handoff.preparedAt,
    acceptedAt: to === "accepted" ? at : handoff.acceptedAt,
    transferredAt: to === "ownership_transferred" ? at : handoff.transferredAt,
    reconciledAt: to === "reconciled" ? at : handoff.reconciledAt,
    revision: handoff.revision + 1,
    updatedAt: at,
  };
}

export function transitionDirectIntervention(
  intervention: DirectIntervention,
  to: DirectIntervention["lifecycleState"],
  at: string,
): DirectIntervention {
  transition("DirectIntervention", intervention.lifecycleState, to, interventionTransitions);
  if (to === "not_required" && intervention.material) {
    throw new Error("A material intervention must reconcile with canonical Room state.");
  }
  return {
    ...intervention,
    lifecycleState: to,
    leadNotifiedAt: to === "lead_notified" ? at : intervention.leadNotifiedAt,
    reconciledAt: to === "reconciled" ? at : intervention.reconciledAt,
    closedAt: to === "closed" ? at : intervention.closedAt,
    revision: intervention.revision + 1,
    updatedAt: at,
  };
}

export function transitionRoleAssumption(
  assumption: RoleAssumption,
  to: RoleAssumption["lifecycleState"],
  at: string,
  failureReason: string | null = null,
): RoleAssumption {
  transition("RoleAssumption", assumption.lifecycleState, to, roleAssumptionTransitions);
  const operation = to === "release_requested" ? "release" : assumption.operation;
  if (to === "topology_reconciled" && operation !== "assume") {
    throw new Error("A Root release cannot enter assumption topology reconciliation.");
  }
  if (to === "released" && operation !== "release") {
    throw new Error("A Root assumption cannot finish as a release.");
  }
  return {
    ...assumption,
    operation,
    lifecycleState: to,
    failureReason: to === "failed" ? failureReason : assumption.failureReason,
    completedAt: to === "active" || to === "released" || to === "failed" ? at : null,
    revision: assumption.revision + 1,
    updatedAt: at,
  };
}

export function transitionLeadReplacement(
  replacement: LeadReplacement,
  to: LeadReplacement["lifecycleState"],
  at: string,
  failureReason: string | null = null,
): LeadReplacement {
  transition("LeadReplacement", replacement.lifecycleState, to, leadReplacementTransitions);
  return {
    ...replacement,
    lifecycleState: to,
    failureReason: to === "failed" ? failureReason : replacement.failureReason,
    completedAt: to === "completed" || to === "failed" ? at : null,
    revision: replacement.revision + 1,
    updatedAt: at,
  };
}

export function assertExclusiveRootLeases(snapshot: SupervisedGovernanceSnapshot): void {
  const seen = new Set<string>();
  for (const lease of snapshot.rootLeases) {
    if (!liveRootStatuses.has(lease.status)) continue;
    if (seen.has(lease.roomId))
      throw new Error(`Room ${lease.roomId} has multiple live Root leases.`);
    seen.add(lease.roomId);
  }
}

const upsert = <T extends { readonly id: string }>(items: ReadonlyArray<T>, value: T) => {
  const index = items.findIndex((item) => item.id === value.id);
  if (index < 0) return [...items, value];
  const next = items.slice();
  next[index] = value;
  return next;
};

export function transferRootAuthority(
  snapshot: SupervisedGovernanceSnapshot,
  input: {
    readonly roomId: string;
    readonly fromSeatId: string;
    readonly toSeatId: string;
    readonly handoffId: string;
    readonly nextLeaseId: RootAuthorityLeaseId;
    readonly previousReceiptId: EffectiveAuthorityReceiptId;
    readonly nextReceiptId: EffectiveAuthorityReceiptId;
    readonly at: string;
  },
): SupervisedGovernanceSnapshot {
  assertExclusiveRootLeases(snapshot);
  const existingNext = snapshot.rootLeases.find((lease) => lease.id === input.nextLeaseId);
  if (existingNext?.status === "active" && existingNext.holderSeatId === input.toSeatId)
    return snapshot;

  const currentLease = snapshot.rootLeases.find(
    (lease) =>
      lease.roomId === input.roomId &&
      lease.holderSeatId === input.fromSeatId &&
      lease.status === "active",
  );
  if (!currentLease) throw new Error("The current Root holder does not own an active lease.");
  const fromSeat = snapshot.agentSeats.find((seat) => seat.id === input.fromSeatId);
  const toSeat = snapshot.agentSeats.find((seat) => seat.id === input.toSeatId);
  if (!fromSeat || !toSeat) throw new Error("Both Root transfer seats must exist.");
  if (toSeat.lifecycleState !== "ready" && toSeat.lifecycleState !== "active") {
    throw new Error("The destination Root seat is not ready.");
  }
  const handoff = snapshot.handoffs.find((candidate) => candidate.id === input.handoffId);
  if (!handoff || handoff.lifecycleState !== "accepted") {
    throw new Error("Root authority cannot transfer before handoff acceptance.");
  }
  if (
    handoff.roomId !== input.roomId ||
    handoff.fromSeatId !== input.fromSeatId ||
    handoff.toSeatId !== input.toSeatId
  ) {
    throw new Error("The accepted handoff does not match the requested Root transfer.");
  }
  const fromReceipt = snapshot.authorityReceipts.find(
    (receipt) => receipt.id === fromSeat.authorityReceiptId,
  );
  const toReceipt = snapshot.authorityReceipts.find(
    (receipt) => receipt.id === toSeat.authorityReceiptId,
  );
  if (!fromReceipt || !toReceipt)
    throw new Error("Both Root transfer seats need authority receipts.");

  const previousReceipt = {
    ...fromReceipt,
    id: input.previousReceiptId,
    rootLeaseIds: fromReceipt.rootLeaseIds.filter((id) => id !== currentLease.id),
    issuedAt: input.at,
  };
  const nextReceipt = {
    ...toReceipt,
    id: input.nextReceiptId,
    effectiveRole:
      toSeat.identityRole === "supervisor" ? ("acting_root" as const) : ("lead" as const),
    rootLeaseIds: [...new Set([...toReceipt.rootLeaseIds, input.nextLeaseId])],
    issuedAt: input.at,
  };
  const releasedLease = {
    ...currentLease,
    status: "released" as const,
    releasedAt: input.at,
    revision: currentLease.revision + 1,
    updatedAt: input.at,
  };
  const nextLease = {
    id: input.nextLeaseId,
    workspaceId: currentLease.workspaceId,
    roomId: currentLease.roomId,
    holderSeatId: toSeat.id,
    status: "active" as const,
    acquiredUnderReceiptId: input.nextReceiptId,
    predecessorLeaseId: currentLease.id,
    acquiredAt: input.at,
    releasedAt: null,
    expiresAt: null,
    revision: 0,
    updatedAt: input.at,
  };
  const transferredHandoff = transitionHandoff(handoff, "ownership_transferred", input.at);
  const nextSnapshot: SupervisedGovernanceSnapshot = {
    ...snapshot,
    agentSeats: snapshot.agentSeats.map((seat) =>
      seat.id === fromSeat.id
        ? {
            ...seat,
            effectiveRole: seat.identityRole,
            authorityReceiptId: previousReceipt.id,
            revision: seat.revision + 1,
            updatedAt: input.at,
          }
        : seat.id === toSeat.id
          ? {
              ...seat,
              effectiveRole: nextReceipt.effectiveRole,
              authorityReceiptId: nextReceipt.id,
              revision: seat.revision + 1,
              updatedAt: input.at,
            }
          : seat,
    ),
    authorityReceipts: [...snapshot.authorityReceipts, previousReceipt, nextReceipt],
    rootLeases: upsert(upsert(snapshot.rootLeases, releasedLease), nextLease),
    handoffs: upsert(snapshot.handoffs, transferredHandoff),
    roleAssumptions: snapshot.roleAssumptions.map((assumption) =>
      assumption.handoffId === handoff.id &&
      assumption.operation === "assume" &&
      assumption.lifecycleState === "previous_root_notified"
        ? transitionRoleAssumption(assumption, "lease_transferred", input.at)
        : assumption,
    ),
    updatedAt: input.at,
  };
  assertExclusiveRootLeases(nextSnapshot);
  return nextSnapshot;
}

export interface GovernanceRecoveryResult {
  readonly snapshot: SupervisedGovernanceSnapshot;
  readonly actions: ReadonlyArray<
    | { readonly kind: "resume_provider"; readonly providerSessionId: string }
    | { readonly kind: "resume_intervention"; readonly interventionId: string }
    | { readonly kind: "reconcile_role_assumption"; readonly roleAssumptionId: string }
    | { readonly kind: "reconcile_lead_replacement"; readonly leadReplacementId: string }
  >;
}

export function recoverGovernanceSnapshot(
  snapshot: SupervisedGovernanceSnapshot,
  at: string,
): GovernanceRecoveryResult {
  const actions: GovernanceRecoveryResult["actions"][number][] = [];
  const providerSessions = snapshot.providerSessions.map((session) => {
    if (!["creating", "resuming", "interrupted"].includes(session.lifecycleState)) return session;
    actions.push({ kind: "resume_provider", providerSessionId: session.id });
    if (session.lifecycleState === "interrupted") {
      return transitionProviderSession(session, "recovering", at);
    }
    return transitionProviderSession(
      transitionProviderSession(session, "interrupted", at),
      "recovering",
      at,
    );
  });
  const recoveringSeatIds = new Set(
    providerSessions
      .filter((session) => session.lifecycleState === "recovering")
      .map((session) => session.seatId),
  );
  const agentSeats = snapshot.agentSeats.map((seat) =>
    recoveringSeatIds.has(seat.id) && seat.lifecycleState !== "recovering"
      ? {
          ...seat,
          lifecycleState: "recovering" as const,
          revision: seat.revision + 1,
          updatedAt: at,
        }
      : seat,
  );
  const roleAssumptions = snapshot.roleAssumptions.map((assumption) => {
    if (assumption.lifecycleState === "lease_transferred") {
      actions.push({ kind: "reconcile_role_assumption", roleAssumptionId: assumption.id });
      return assumption;
    }
    if (
      ["requested", "authority_validated", "destination_ready", "previous_root_notified"].includes(
        assumption.lifecycleState,
      )
    ) {
      return transitionRoleAssumption(
        assumption,
        "failed",
        at,
        "Daemon restarted before atomic Root transfer; the previous Root remains active.",
      );
    }
    return assumption;
  });
  const leadReplacements = snapshot.leadReplacements.map((replacement) => {
    if (replacement.lifecycleState === "lease_transferred") {
      actions.push({ kind: "reconcile_lead_replacement", leadReplacementId: replacement.id });
      return replacement;
    }
    if (
      [
        "requested",
        "provisioning_replacement",
        "replacement_ready",
        "handoff_prepared",
        "handoff_accepted",
      ].includes(replacement.lifecycleState)
    ) {
      return transitionLeadReplacement(
        replacement,
        "failed",
        at,
        "Daemon restarted before atomic Root transfer; the previous Root remains active.",
      );
    }
    return replacement;
  });
  for (const intervention of snapshot.directInterventions) {
    if (intervention.lifecycleState === "executing") {
      actions.push({ kind: "resume_intervention", interventionId: intervention.id });
    }
  }
  const changed =
    providerSessions.some((session, index) => session !== snapshot.providerSessions[index]) ||
    agentSeats.some((seat, index) => seat !== snapshot.agentSeats[index]) ||
    roleAssumptions.some((assumption, index) => assumption !== snapshot.roleAssumptions[index]) ||
    leadReplacements.some((replacement, index) => replacement !== snapshot.leadReplacements[index]);
  const recovered = changed
    ? {
        ...snapshot,
        providerSessions,
        agentSeats,
        roleAssumptions,
        leadReplacements,
        updatedAt: at,
      }
    : snapshot;
  assertExclusiveRootLeases(recovered);
  return { snapshot: recovered, actions };
}

export function settleGovernanceRecoveryActions(
  snapshot: SupervisedGovernanceSnapshot,
  actions: GovernanceRecoveryResult["actions"],
  at: string,
): SupervisedGovernanceSnapshot {
  let next = snapshot;
  for (const action of actions) {
    if (action.kind === "resume_provider") {
      const providerSession = next.providerSessions.find(
        (session) => session.id === action.providerSessionId,
      );
      if (!providerSession || providerSession.lifecycleState !== "recovering") continue;
      const failedProviderSession = transitionProviderSession(providerSession, "failed", at);
      next = {
        ...next,
        providerSessions: next.providerSessions.map((session) =>
          session.id === failedProviderSession.id ? failedProviderSession : session,
        ),
        agentSeats: next.agentSeats.map((seat) =>
          seat.id === failedProviderSession.seatId && seat.lifecycleState === "recovering"
            ? transitionAgentSeat(seat, "failed", at)
            : seat,
        ),
        updatedAt: at,
      };
      continue;
    }
    if (action.kind === "resume_intervention") {
      const intervention = next.directInterventions.find(
        (candidate) => candidate.id === action.interventionId,
      );
      if (!intervention || intervention.lifecycleState !== "executing") continue;
      const failedIntervention = transitionDirectIntervention(intervention, "failed", at);
      next = {
        ...next,
        directInterventions: next.directInterventions.map((candidate) =>
          candidate.id === failedIntervention.id ? failedIntervention : candidate,
        ),
        updatedAt: at,
      };
      continue;
    }

    if (action.kind === "reconcile_role_assumption") {
      const assumption = next.roleAssumptions.find(
        (candidate) => candidate.id === action.roleAssumptionId,
      );
      if (!assumption || assumption.lifecycleState !== "lease_transferred") continue;
      const reconciled = transitionRoleAssumption(
        assumption,
        assumption.operation === "assume" ? "topology_reconciled" : "released",
        at,
      );
      next = {
        ...next,
        roleAssumptions: next.roleAssumptions.map((candidate) =>
          candidate.id === reconciled.id ? reconciled : candidate,
        ),
        updatedAt: at,
      };
      continue;
    }
    if (action.kind !== "reconcile_lead_replacement") continue;
    const replacement = next.leadReplacements.find(
      (candidate) => candidate.id === action.leadReplacementId,
    );
    if (replacement?.lifecycleState === "lease_transferred") {
      const reconciled = transitionLeadReplacement(replacement, "topology_reconciled", at);
      next = {
        ...next,
        leadReplacements: next.leadReplacements.map((candidate) =>
          candidate.id === reconciled.id ? reconciled : candidate,
        ),
        updatedAt: at,
      };
    }
  }
  assertExclusiveRootLeases(next);
  return next;
}
