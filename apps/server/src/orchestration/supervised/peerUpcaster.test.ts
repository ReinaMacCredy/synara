import assert from "node:assert/strict";

import { describe, it } from "vitest";
import { Schema } from "effect";

import { SupervisedDomainEvent } from "@synara/contracts";

import { upcastLegacyPeerEventV1 } from "./peerUpcaster.ts";

const now = "2026-08-09T00:00:00.000Z";

describe("Peer v1 upcaster", () => {
  it("maps legacy Specialist events to the canonical Peer event and payload", () => {
    const legacy = Schema.decodeUnknownSync(SupervisedDomainEvent)({
      sequence: 42,
      eventId: "event-42",
      aggregateKind: "specialist",
      aggregateId: "specialty-1",
      type: "supervised.specialist-upserted",
      payload: {
        acceptedRevision: 1,
        actor: { kind: "migration", actorId: "migration-108" },
        specialist: {
          id: "specialty-1",
          profilePresetId: "profile-peer-reviewer",
          concern: "review",
          status: "retained",
          allowedScopes: [{ kind: "seat", role: "specialist", seatId: "peer-thread" }],
          latestSnapshotId: "snapshot-1",
          expiresAt: "2027-08-09T00:00:00.000Z",
          revision: 1,
          createdAt: now,
          updatedAt: now,
        },
        specialistSnapshot: {
          id: "snapshot-1",
          specialistId: "specialty-1",
          profileContentHash: `sha256:${"a".repeat(64)}`,
          contextRefs: [],
          evidenceRefs: [],
          sanitized: true,
          compatibleSchemaVersions: ["1.0.0"],
          createdAt: now,
          expiresAt: "2027-08-09T00:00:00.000Z",
        },
      },
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: { schemaVersion: "1.0.0" },
    });

    const event = upcastLegacyPeerEventV1(legacy);

    assert.equal(event.type, "supervised.peer-upserted");
    assert.equal(event.aggregateKind, "peer");
    assert.equal(event.payload.peerSpecialty?.id, "specialty-1");
    assert.deepEqual(event.payload.peerSpecialty?.allowedScopes, [
      { kind: "seat", role: "peer", seatId: "peer-thread" },
    ]);
    assert.equal(event.payload.peerSpecialtySnapshot?.peerSpecialtyId, "specialty-1");
    assert.equal(event.metadata.schemaVersion, "1.0.0");
  });

  it("rejects unknown event schema versions", () => {
    const event = Schema.decodeUnknownSync(SupervisedDomainEvent)({
      sequence: 1,
      eventId: "event-unknown",
      aggregateKind: "supervised_room",
      aggregateId: "room-1",
      type: "supervised.room-created",
      payload: { acceptedRevision: 0, actor: { kind: "migration", actorId: "test" } },
      occurredAt: now,
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: { schemaVersion: "2.0.0" },
    });
    assert.throws(() => upcastLegacyPeerEventV1(event), /Unsupported Supervised event schema/);
  });
});
