import assert from "node:assert/strict";
import { it } from "vitest";

import { SupervisorNotebookEntry } from "@synara/contracts";
import { Schema } from "effect";

import { supervisorNotebookEntryByline } from "./SupervisedGovernanceSettingsPanel";

it("shows the durable Supervisor author seat in each notebook entry byline", () => {
  const entry = Schema.decodeUnknownSync(SupervisorNotebookEntry)({
    id: "notebook-entry",
    workspaceId: "workspace-1",
    roomId: "room-1",
    taskNodeId: "task-node-1",
    concern: "delivery",
    authorSeatId: "seat-supervisor-successor",
    kind: "lesson",
    content: "Durable lesson.",
    evidenceRefs: ["evidence-1"],
    confidence: 0.91,
    supersedesEntryId: null,
    protectionClass: "internal",
    redactedAt: null,
    createdAt: "2026-08-10T00:00:00.000Z",
  });

  assert.equal(
    supervisorNotebookEntryByline(entry),
    "Room room-1 · author seat-supervisor-successor · confidence 91%",
  );
});
