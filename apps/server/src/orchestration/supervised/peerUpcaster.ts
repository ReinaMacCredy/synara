import type {
  LegacySpecialistSnapshot,
  ModelSessionTrace,
  PeerSpecialty,
  PeerSpecialtySnapshot,
  SupervisedDomainEvent,
} from "@veylen/contracts";

const SUPERVISED_EVENT_SCHEMA_VERSION = "1.0.0";

export const assertSupportedSupervisedEventVersion = (event: SupervisedDomainEvent): void => {
  if (event.metadata.schemaVersion !== SUPERVISED_EVENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Supervised event schema '${event.metadata.schemaVersion}' for ${event.type}.`,
    );
  }
};

export const upcastLegacyPeerSpecialtyV1 = (specialty: PeerSpecialty): PeerSpecialty => {
  let changed = false;
  const allowedScopes = specialty.allowedScopes.map((scope) => {
    if (scope.kind !== "seat" || scope.role !== "specialist") return scope;
    changed = true;
    return { ...scope, role: "peer" as const };
  });
  return changed ? { ...specialty, allowedScopes } : specialty;
};

export const upcastLegacyPeerSpecialtySnapshotV1 = (
  snapshot: LegacySpecialistSnapshot,
): PeerSpecialtySnapshot => {
  const { specialistId, ...rest } = snapshot;
  return { ...rest, peerSpecialtyId: specialistId };
};

export const upcastLegacyPeerModelSessionV1 = (session: ModelSessionTrace): ModelSessionTrace => {
  const { specialistId, ...canonical } = session;
  return {
    ...canonical,
    peerSpecialtyId: session.peerSpecialtyId ?? specialistId ?? null,
    role: session.role === "specialist" ? "peer" : session.role,
  };
};

// TODO(supervised-runtime): Remove this v1 journal upcaster on or after 2027-08-09
// once every supported database has replayed migration 108 and compacted old events.
export const upcastLegacyPeerEventV1 = (event: SupervisedDomainEvent): SupervisedDomainEvent => {
  assertSupportedSupervisedEventVersion(event);
  if (event.type === "supervised.model-session-upserted" && event.payload.modelSession) {
    return {
      ...event,
      payload: {
        ...event.payload,
        modelSession: upcastLegacyPeerModelSessionV1(event.payload.modelSession),
      },
    };
  }
  if (event.type !== "supervised.specialist-upserted") {
    if (!event.payload.peerSpecialty) return event;
    const peerSpecialty = upcastLegacyPeerSpecialtyV1(event.payload.peerSpecialty);
    return peerSpecialty === event.payload.peerSpecialty
      ? event
      : { ...event, payload: { ...event.payload, peerSpecialty } };
  }
  const specialty = event.payload.peerSpecialty ?? event.payload.specialist;
  return {
    ...event,
    aggregateKind: "peer",
    type: "supervised.peer-upserted",
    payload: {
      ...event.payload,
      peerSpecialty: specialty ? upcastLegacyPeerSpecialtyV1(specialty) : undefined,
      peerSpecialtySnapshot:
        event.payload.peerSpecialtySnapshot ??
        (event.payload.specialistSnapshot
          ? upcastLegacyPeerSpecialtySnapshotV1(event.payload.specialistSnapshot)
          : undefined),
    },
    metadata: event.metadata,
  };
};
