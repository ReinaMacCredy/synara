import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Effect } from "effect";

import type {
  SupervisorNotebookCompactionReceipt,
  SupervisorNotebookEntry,
  SupervisorNotebookView,
  SupervisedGovernanceSnapshot,
} from "@veylen/contracts";

import type { SupervisedGovernanceRepositoryShape } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import { makeSupervisedTools } from "../../orchestration/supervised/toolRegistry.ts";

const now = "2026-08-10T00:00:00.000Z";

function governanceSnapshot(): SupervisedGovernanceSnapshot {
  const supervisorSeat = (suffix: string) => ({
    id: `seat-supervisor-${suffix}`,
    workspaceId: "workspace-1",
    roomIds: ["room-1"],
    identityRole: "supervisor",
    effectiveRole: "supervisor",
    profileId: "profile-supervisor",
    providerSessionId: null,
    lifecycleState: "active",
    workState: "idle",
    authorityReceiptId: `receipt-supervisor-${suffix}`,
    threadId: `thread-supervisor-${suffix}`,
    projectId: null,
    profileSnapshotId: null,
    predecessorThreadIds: [],
    displayName: `Supervisor ${suffix.toUpperCase()}`,
    createdAt: now,
    retainedAt: null,
    retiredAt: null,
    revision: 1,
    updatedAt: now,
  });
  const supervisorReceipt = (suffix: string) => ({
    id: `receipt-supervisor-${suffix}`,
    actorSeatId: `seat-supervisor-${suffix}`,
    identityRole: "supervisor",
    effectiveRole: "supervisor",
    workspaceScopes: ["workspace-1"],
    roomScopes: ["room-1"],
    taskNodeScopes: [],
    allowedCommands: ["notebook.append", "notebook.compact"],
    allowedTools: [
      "supervised.notebook.search",
      "supervised.notebook.append",
      "supervised.notebook.compact",
    ],
    rootLeaseIds: [],
    mandateIds: [],
    runPolicyRevision: 1,
    issuedAt: now,
    expiresAt: null,
    revokedAt: null,
  });
  return {
    revision: 7,
    workspaces: [
      {
        id: "workspace-1",
        ownerNamespace: "owner",
        title: "Workspace",
        lifecycleState: "active",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agentSeats: [
      supervisorSeat("a"),
      supervisorSeat("b"),
      {
        id: "seat-lead-root",
        workspaceId: "workspace-1",
        roomIds: ["room-1"],
        identityRole: "lead",
        effectiveRole: "lead",
        profileId: "profile-lead",
        providerSessionId: null,
        lifecycleState: "active",
        workState: "idle",
        authorityReceiptId: "receipt-lead-root",
        threadId: "thread-lead-root",
        projectId: "project-1",
        profileSnapshotId: null,
        predecessorThreadIds: [],
        displayName: "Lead Root",
        createdAt: now,
        retainedAt: null,
        retiredAt: null,
        revision: 1,
        updatedAt: now,
      },
    ],
    providerSessions: [],
    authorityReceipts: [
      supervisorReceipt("a"),
      supervisorReceipt("b"),
      {
        id: "receipt-lead-root",
        actorSeatId: "seat-lead-root",
        identityRole: "lead",
        effectiveRole: "lead",
        workspaceScopes: ["workspace-1"],
        roomScopes: ["room-1"],
        taskNodeScopes: [],
        allowedCommands: ["task.accept"],
        allowedTools: ["supervised.task.get"],
        rootLeaseIds: ["lease-lead-root"],
        mandateIds: [],
        runPolicyRevision: 1,
        issuedAt: now,
        expiresAt: null,
        revokedAt: null,
      },
    ],
    rootLeases: [
      {
        id: "lease-lead-root",
        workspaceId: "workspace-1",
        roomId: "room-1",
        holderSeatId: "seat-lead-root",
        status: "active",
        acquiredUnderReceiptId: "receipt-lead-root",
        predecessorLeaseId: null,
        acquiredAt: now,
        releasedAt: null,
        expiresAt: null,
        revision: 1,
        updatedAt: now,
      },
    ],
    handoffs: [],
    roleAssumptions: [],
    leadReplacements: [],
    humanDirectives: [],
    standingMandates: [],
    directInterventions: [],
    notebookEntries: [],
    notebookCursors: [],
    notebookCompactionReceipts: [],
    modelCapabilityProfiles: [],
    userModelPreferenceProfiles: [],
    modelTelemetryAggregates: [],
    modelSelectionReceipts: [],
    orchestration: {
      revision: 0,
      agentSeats: [],
      profiles: [],
      profileSnapshots: [],
      missions: [],
      workflowDirectives: [],
      workflowConflicts: [],
      advice: [],
      observationCursors: [],
      wakeQueue: [],
      rotations: [],
      updatedAt: now,
    },
    updatedAt: now,
  } as unknown as SupervisedGovernanceSnapshot;
}

const context = (suffix: string) => ({
  callerThreadId: `thread-supervisor-${suffix}`,
  callerSessionKey: `session-${suffix}`,
  callerProvider: "codex" as const,
  callerTurnId: `turn-${suffix}`,
  callerDispatchOrigin: "user" as const,
  assertCallerTurnActive: () => Effect.succeed(undefined),
});

describe("Shared Supervisor Notebook host path", () => {
  it("shares append-only entries with a scoped successor without mutating Root authority or cursors", async () => {
    const governance = governanceSnapshot();
    const authorityBefore = structuredClone({
      lead: governance.agentSeats.find((seat) => seat.id === "seat-lead-root"),
      receipt: governance.authorityReceipts.find((receipt) => receipt.id === "receipt-lead-root"),
      leases: governance.rootLeases,
    });
    let entries: SupervisorNotebookEntry[] = [];
    let compactionReceipts: SupervisorNotebookCompactionReceipt[] = [];
    let cursorWrites = 0;
    const notebookReads: Array<
      Parameters<SupervisedGovernanceRepositoryShape["getNotebookState"]>[0]
    > = [];
    const governanceRepository = {
      getSnapshot: () => Effect.succeed(governance),
      getNotebookState: (
        input: Parameters<SupervisedGovernanceRepositoryShape["getNotebookState"]>[0],
      ) =>
        Effect.sync(() => {
          notebookReads.push(input);
          return { entries, compactionReceipts, cursor: null };
        }),
      appendNotebookEntry: (entry: SupervisorNotebookEntry) =>
        Effect.sync(() => {
          if (entries.some((candidate) => candidate.id === entry.id)) return false;
          entries = [...entries, entry];
          return true;
        }),
      appendNotebookCompaction: (planned: {
        readonly summaryEntry: SupervisorNotebookEntry;
        readonly receipt: SupervisorNotebookCompactionReceipt;
      }) =>
        Effect.sync(() => {
          if (compactionReceipts.some((receipt) => receipt.id === planned.receipt.id)) {
            return false;
          }
          entries = [...entries, planned.summaryEntry];
          compactionReceipts = [...compactionReceipts, planned.receipt];
          return true;
        }),
      putNotebookCursor: () =>
        Effect.sync(() => {
          cursorWrites += 1;
        }),
    } as unknown as SupervisedGovernanceRepositoryShape;
    const tools = makeSupervisedTools({
      governanceRepository,
      snapshotQuery: {
        getSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 0,
            spaces: [],
            projects: [],
            threads: [],
            supervised: { rooms: [], taskNodes: [] },
            updatedAt: now,
          } as never),
      } as never,
      orchestrationEngine: {} as never,
      runtimeDaemon: {} as never,
    });
    const append = tools.find(
      (tool) => tool.definition.name === "append_supervisor_notebook_entry",
    )!;
    const search = tools.find((tool) => tool.definition.name === "search_supervisor_notebook")!;
    const compact = tools.find((tool) => tool.definition.name === "compact_supervisor_notebook")!;

    const first = await Effect.runPromise(
      append.execute(
        {
          concern: "delivery",
          kind: "observation",
          content: "Supervisor A observed a durable delivery issue.",
          evidenceRefs: ["evidence-a"],
          confidence: 0.8,
        },
        context("a"),
      ),
    );
    const second = await Effect.runPromise(
      append.execute(
        {
          concern: "delivery",
          kind: "lesson",
          content: "Supervisor B retained the successor lesson.",
          evidenceRefs: ["evidence-b"],
          confidence: 0.9,
        },
        context("b"),
      ),
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((entry) => entry.authorSeatId),
      ["seat-supervisor-a", "seat-supervisor-b"],
    );
    assert.notEqual(entries[0]?.id, entries[1]?.id);

    entries = [
      ...entries,
      {
        ...entries[0]!,
        id: "notebook-hidden-room" as never,
        roomId: "room-2" as never,
        content: "Out-of-scope Room entry.",
      },
    ];
    const searched = await Effect.runPromise(
      search.execute({ incremental: false, limit: 20 }, context("b")),
    );
    assert.equal(searched.ok, true);
    if (!searched.ok) return;
    const view = searched.value as SupervisorNotebookView;
    assert.equal(search.definition.readOnly, true);
    assert.equal(view.viewerSeatId, "seat-supervisor-b");
    assert.deepEqual(view.entries.map((entry) => entry.authorSeatId).toSorted(), [
      "seat-supervisor-a",
      "seat-supervisor-b",
    ]);
    assert.equal(
      view.entries.some((entry) => entry.id === "notebook-hidden-room"),
      false,
    );
    assert.equal(cursorWrites, 0);
    const searchRead = notebookReads.find(
      (input) => input.entryIds === undefined && input.roomIds !== undefined,
    )!;
    assert.deepEqual(searchRead.roomIds, ["room-1"]);
    assert.equal(searchRead.includeWorkspaceEntries, true);
    assert.deepEqual(searchRead.allowedProtectionClasses, ["workspace", "internal"]);

    const sourceEntryIds = entries.slice(0, 2).map((entry) => entry.id);
    const compacted = await Effect.runPromise(
      compact.execute(
        { sourceEntryIds, content: "Idempotent shared successor summary." },
        context("b"),
      ),
    );
    const retried = await Effect.runPromise(
      compact.execute(
        {
          sourceEntryIds: sourceEntryIds.toReversed(),
          content: "Idempotent shared successor summary.",
        },
        context("b"),
      ),
    );
    assert.equal(compacted.ok, true);
    assert.equal(retried.ok, true);
    if (retried.ok) {
      assert.equal((retried.value as { readonly idempotent?: boolean }).idempotent, true);
    }
    assert.equal(compactionReceipts.length, 1);

    assert.deepEqual(
      {
        lead: governance.agentSeats.find((seat) => seat.id === "seat-lead-root"),
        receipt: governance.authorityReceipts.find((receipt) => receipt.id === "receipt-lead-root"),
        leases: governance.rootLeases,
      },
      authorityBefore,
    );
  });
});
