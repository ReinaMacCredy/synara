import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  HandoffAttemptId,
  HandoffId,
  HandoffPreparationSnapshot,
  StartHandoffPreparationInput,
} from "./handoff";
import { ProjectId, ThreadId } from "./baseSchemas";

const snapshot = {
  attemptId: HandoffAttemptId.makeUnsafe("handoff-attempt-1"),
  handoffId: HandoffId.makeUnsafe("handoff-1"),
  destinationDraftThreadId: ThreadId.makeUnsafe("destination-thread"),
  state: "preparing",
  phase: "Preparing cited handoff packet",
  progressPercent: 55,
  runtime: { provider: "codex", model: "gpt-5.6-luna", effort: "high" },
  settingsRevision: 1,
  capsule: {
    schemaVersion: 1,
    sourceThreadId: ThreadId.makeUnsafe("source-thread"),
    sourceTitle: "Source thread",
    sourceMode: "project",
    sourceProvider: "codex",
    projectId: ProjectId.makeUnsafe("project"),
    projectTitle: "Synara",
    workspaceRoot: "/tmp/synara",
    environment: { mode: "local", branch: "main", worktreePath: null },
    sourceCursor: 12,
    sourceDigest: "source-digest",
    items: [],
    omissions: [],
    sealedAt: "2026-08-02T00:00:00.000Z",
    capsuleHash: "capsule-hash",
  },
  handoffPrompt: "Preserve dissent",
  packet: null,
  error: null,
  startedAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:01.000Z",
} as const;

describe("HandoffPreparationSnapshot", () => {
  it("accepts phase progress percentages from 0 through 100 only", () => {
    expect(Schema.is(HandoffPreparationSnapshot)(snapshot)).toBe(true);
    expect(Schema.is(HandoffPreparationSnapshot)({ ...snapshot, progressPercent: 101 })).toBe(
      false,
    );
  });
});

describe("StartHandoffPreparationInput", () => {
  const input = {
    sourceThreadId: ThreadId.makeUnsafe("source-thread"),
    destinationDraftThreadId: ThreadId.makeUnsafe("destination-thread"),
    destinationMode: "orchestrator_root",
    handoffPrompt: "Preserve dissent",
  } as const;

  it("accepts a frozen per-attempt runtime and rejects an empty model", () => {
    expect(
      Schema.is(StartHandoffPreparationInput)({
        ...input,
        runtime: { provider: "codex", model: "gpt-5.6-luna", effort: "high" },
      }),
    ).toBe(true);
    expect(
      Schema.is(StartHandoffPreparationInput)({
        ...input,
        runtime: { provider: "codex", model: "", effort: "high" },
      }),
    ).toBe(false);
  });
});
