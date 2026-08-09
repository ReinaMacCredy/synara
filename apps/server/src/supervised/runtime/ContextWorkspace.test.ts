import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";

import type { ContextRecord, ContextWorkspace } from "@synara/contracts";

import {
  ContextRevisionConflictError,
  appendContextRecord,
  createContextBlobStore,
} from "./ContextWorkspace.ts";

const now = "2026-08-07T00:00:00.000Z";
const workspace = {
  id: "workspace-1",
  projectId: "project-1",
  roomId: "room-1",
  revision: 2,
  highWaterSequence: 10,
  retention: { maxAgeMs: 1_000, maxInlineBytes: 1_024, compactAfterRecords: 10 },
  createdAt: now,
  updatedAt: now,
} as ContextWorkspace;
const record = {
  id: "record-1",
  workspaceId: "workspace-1",
  kind: "evidence",
  scope: { kind: "room", roomId: "room-1" },
  title: "Test receipt",
  inlineText: "passed",
  blob: null,
  sourceEventIds: ["event-1"],
  evidenceRefs: [],
  status: "current",
  contentRevision: 1,
  createdBy: { kind: "seat", actorId: "peer-1", seatId: "peer-1" },
  createdAt: now,
  updatedAt: now,
} as ContextRecord;

describe("Durable Context Workspace", () => {
  it("uses expected revision and preserves immutable record identity", () => {
    const result = appendContextRecord(workspace, record, 2);
    assert.equal(result.workspace.revision, 3);
    assert.equal(result.record.id, record.id);
    assert.throws(() => appendContextRecord(workspace, record, 1), ContextRevisionConflictError);
  });

  it("stores large payloads by content hash and verifies read integrity", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "synara-context-"));
    try {
      const store = createContextBlobStore(directory);
      const bytes = new TextEncoder().encode("durable evidence");
      const first = await store.put(bytes, "text/plain", now);
      const second = await store.put(bytes, "text/plain", now);
      assert.equal(first.hash, second.hash);
      assert.equal(await store.verify(first), true);
      assert.equal(new TextDecoder().decode(await store.read(first)), "durable evidence");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
