import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { PeerSpecialty, PeerSpecialtySnapshot } from "@synara/contracts";

import { mayResumePeerSpecialty } from "./RetainedPeerSpecialties.ts";

const now = "2026-08-07T00:00:00.000Z";
const hash = `sha256:${"a".repeat(64)}` as PeerSpecialtySnapshot["profileContentHash"];
const specialty = {
  id: "peer-specialty-1",
  profilePresetId: "profile-1",
  concern: "security",
  status: "retained",
  allowedScopes: [{ kind: "project", projectId: "project-1" }],
  latestSnapshotId: "snapshot-1",
  expiresAt: "2026-08-08T00:00:00.000Z",
  revision: 1,
  createdAt: now,
  updatedAt: now,
} as PeerSpecialty;
const snapshot = {
  id: "snapshot-1",
  peerSpecialtyId: "peer-specialty-1",
  profileContentHash: hash,
  contextRefs: [],
  evidenceRefs: [],
  sanitized: true,
  compatibleSchemaVersions: ["1.0.0"],
  createdAt: now,
  expiresAt: "2026-08-08T00:00:00.000Z",
} as PeerSpecialtySnapshot;

describe("Retained Peer specialties", () => {
  it("resumes only sanitized, compatible, scoped snapshots", () => {
    const decision = mayResumePeerSpecialty({
      specialty,
      snapshot,
      requestedScope: { kind: "project", projectId: "project-1" as never },
      activeProfileContentHash: hash,
      supportedSchemaVersions: new Set(["1.0.0"]),
      now,
    });
    assert.equal(decision.allowed, true);
    assert.equal(
      mayResumePeerSpecialty({
        specialty,
        snapshot: { ...snapshot, sanitized: false },
        requestedScope: { kind: "project", projectId: "project-1" as never },
        activeProfileContentHash: hash,
        supportedSchemaVersions: new Set(["1.0.0"]),
        now,
      }).allowed,
      false,
    );
  });
});
