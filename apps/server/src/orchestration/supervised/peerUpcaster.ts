import type {
  LegacySpecialistSnapshot,
  ModelSessionTrace,
  PeerSpecialtySnapshot,
  SupervisedDomainEvent,
} from "@synara/contracts";

export const upcastLegacyPeerSpecialtySnapshotV1 = (
  snapshot: LegacySpecialistSnapshot,
): PeerSpecialtySnapshot => {
  const { specialistId, ...rest } = snapshot;
  return { ...rest, peerSpecialtyId: specialistId };
};

export const upcastLegacyPeerModelSessionV1 = (
  session: ModelSessionTrace,
): ModelSessionTrace => ({
  ...session,
  peerSpecialtyId: session.peerSpecialtyId ?? session.specialistId ?? null,
  role: session.role === "specialist" ? "peer" : session.role,
});

// TODO(supervised-runtime): Remove this v1 journal upcaster on or after 2027-08-09
// once every supported database has replayed migration 108 and compacted old events.
export const upcastLegacyPeerEventV1 = (
  event: SupervisedDomainEvent,
): SupervisedDomainEvent => {
  if (event.type === "supervised.model-session-upserted" && event.payload.modelSession) {
    return {
      ...event,
      payload: {
        ...event.payload,
        modelSession: upcastLegacyPeerModelSessionV1(event.payload.modelSession),
      },
    };
  }
  if (event.type !== "supervised.specialist-upserted") return event;
  return {
    ...event,
    aggregateKind: "peer",
    type: "supervised.peer-upserted",
    payload: {
      ...event.payload,
      peerSpecialty: event.payload.peerSpecialty ?? event.payload.specialist,
      peerSpecialtySnapshot:
        event.payload.peerSpecialtySnapshot ??
        (event.payload.specialistSnapshot
          ? upcastLegacyPeerSpecialtySnapshotV1(event.payload.specialistSnapshot)
          : undefined),
    },
    metadata: {
      ...event.metadata,
      schemaVersion: "supervised/peer-v1",
    },
  };
};
