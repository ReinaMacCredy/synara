import {
  HandoffGrantId,
  HandoffId,
  ProjectId,
  ThreadId,
  type AcceptedCrossModeHandoffV1,
} from "@synara/contracts";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { HostToolInvocationContext } from "../orchestration/hostTools/runtime.ts";
import { makeHandoffDestinationTools } from "./handoffDestinationToolRegistry.ts";
import { canonicalHandoffSourceItems, handoffSourceDigest } from "./handoffSourceMaterial.ts";

const createdAt = "2026-08-02T00:00:00.000Z";
const sourceThreadId = ThreadId.makeUnsafe("source-thread");
const destinationThreadId = ThreadId.makeUnsafe("destination-thread");
const projectId = ProjectId.makeUnsafe("project");
const sourceMessages = [
  { id: "m1", role: "user", text: "Design the durable handoff flow", createdAt },
  { id: "m2", role: "assistant", text: "Keep source authority explicit", createdAt },
];
const sourceItems = canonicalHandoffSourceItems(sourceMessages);

const accepted = (status: "active" | "suspended" | "revoked" = "active") =>
  ({
    schemaVersion: 1,
    handoffId: HandoffId.makeUnsafe("handoff-1"),
    sourceTitle: "Source",
    sourceMode: "project",
    destinationMode: "supervised",
    sourceCursor: 12,
    sourceDigest: handoffSourceDigest(sourceItems),
    capsule: {
      schemaVersion: 1,
      sourceThreadId,
      sourceTitle: "Source",
      sourceMode: "project",
      sourceProvider: "codex",
      projectId,
      projectTitle: "Project",
      workspaceRoot: "/tmp/project",
      environment: { mode: "local", branch: null, worktreePath: null },
      sourceCursor: 12,
      sourceDigest: handoffSourceDigest(sourceItems),
      items: sourceItems,
      omissions: [],
      sealedAt: createdAt,
      capsuleHash: "capsule-hash",
    },
    handoffPrompt: "Preserve dissent",
    packet: null,
    sourceLinkOnly: true,
    grant: {
      grantId: HandoffGrantId.makeUnsafe("grant-1"),
      handoffId: HandoffId.makeUnsafe("handoff-1"),
      sourceThreadId,
      destinationThreadId,
      projectId,
      allowedViews: [
        "status",
        "last_message",
        "tail_since_cursor",
        "transcript",
        "artifacts",
        "activity",
      ],
      grantedThroughCursor: 12,
      status,
      revision: 1,
      createdAt,
      lastAccessedAt: null,
      revokedAt: status === "revoked" ? createdAt : null,
    },
  }) satisfies AcceptedCrossModeHandoffV1;

const context = (threadId = destinationThreadId): HostToolInvocationContext => ({
  callerThreadId: threadId,
  callerSessionKey: `session:${threadId}`,
  callerProvider: "codex",
  callerTurnId: null,
  assertCallerTurnActive: () => Effect.void,
});

const query = (handoff: AcceptedCrossModeHandoffV1) =>
  ({
    getThreadDetailSnapshotById: (threadId: ThreadId) => {
      if (threadId === destinationThreadId) {
        return Effect.succeed(
          Option.some({
            thread: { handoff: { crossMode: handoff } },
            snapshotSequence: 20,
          } as never),
        );
      }
      if (threadId === sourceThreadId) {
        return Effect.succeed(
          Option.some({ thread: { messages: sourceMessages }, snapshotSequence: 18 } as never),
        );
      }
      return Effect.succeed(Option.none());
    },
  }) as unknown as ProjectionSnapshotQueryShape;

describe("handoff destination native tools", () => {
  it("lists and reads only the grant bound to the authenticated destination", async () => {
    const entries = makeHandoffDestinationTools({ snapshotQuery: query(accepted()) });
    const list = entries.find((entry) => entry.definition.name === "list_handoff_sources")!;
    const read = entries.find((entry) => entry.definition.name === "read_handoff_source")!;

    expect(await Effect.runPromise(list.isVisible(context()))).toBe(true);
    const listed = await Effect.runPromise(list.execute({}, context()));
    expect(listed).toMatchObject({
      ok: true,
      value: [{ grantId: "grant-1", sourceThreadId, hasNewerActivity: true }],
    });

    const transcript = await Effect.runPromise(
      read.execute({ grantId: "grant-1", view: "transcript", limit: 1 }, context()),
    );
    expect(transcript).toMatchObject({
      ok: true,
      value: { items: [{ ref: "message:m1" }], hasNewerActivity: true },
    });

    const denied = await Effect.runPromise(
      read.execute(
        { grantId: "grant-1", view: "transcript" },
        context(ThreadId.makeUnsafe("other")),
      ),
    );
    expect(denied).toMatchObject({ ok: false, error: { code: "handoff_grant_not_found" } });
  });

  it("removes revoked grants from the provider-native surface", async () => {
    const entries = makeHandoffDestinationTools({ snapshotQuery: query(accepted("revoked")) });
    const list = entries.find((entry) => entry.definition.name === "list_handoff_sources")!;
    expect(await Effect.runPromise(list.isVisible(context()))).toBe(false);
  });

  it("fails closed when the frozen snapshot can no longer be reconstructed", async () => {
    const changedQuery = {
      ...query(accepted()),
      getThreadDetailSnapshotById: (threadId: ThreadId) =>
        threadId === sourceThreadId
          ? Effect.succeed(
              Option.some({
                thread: { messages: [{ ...sourceMessages[0], text: "mutated" }] },
                snapshotSequence: 18,
              } as never),
            )
          : query(accepted()).getThreadDetailSnapshotById(threadId),
    } as ProjectionSnapshotQueryShape;
    const read = makeHandoffDestinationTools({ snapshotQuery: changedQuery }).find(
      (entry) => entry.definition.name === "read_handoff_source",
    )!;
    const result = await Effect.runPromise(
      read.execute({ grantId: "grant-1", view: "transcript" }, context()),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "handoff_source_snapshot_changed" },
    });
  });

  it("returns invalid tool arguments to the model without killing the provider session", async () => {
    const search = makeHandoffDestinationTools({ snapshotQuery: query(accepted()) }).find(
      (entry) => entry.definition.name === "search_handoff_source",
    )!;

    const result = await Effect.runPromise(
      search.execute({ grantId: "grant-1", query: "authority", limit: 50 }, context()),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "handoff_input_invalid",
        message: "'limit' must be an integer between 1 and 20.",
      },
    });
  });
});
