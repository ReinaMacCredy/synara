import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LeadSeatId,
  ProfileSnapshotId,
  SupervisionMissionId,
  SupervisorSeatId,
} from "@veylen/contracts";
import { Effect } from "effect";

import { SUPERVISED_BASE_POLICY_HASH } from "../../supervised/runtime/HarnessPatchPolicy.ts";
import { supervisedInstructionForSession } from "./protocolV1.ts";

it.effect("requires a visible completion after Supervisor tool activity", () =>
  Effect.sync(() => {
    const instruction = supervisedInstructionForSession({
      role: "supervisor",
      supervisorSeatId: SupervisorSeatId.makeUnsafe("supervisor-release"),
      missionIds: [SupervisionMissionId.makeUnsafe("mission-release")],
      profileSnapshot: {
        id: ProfileSnapshotId.makeUnsafe("snapshot-release"),
        sourcePresetId: null,
        sourcePresetName: "Supervisor Default",
        runtime: {
          provider: "codex",
          model: "gpt-5.6-luna",
          reasoningEffort: "low",
          sandboxMode: "danger-full-access",
          approvalPolicy: "never",
          developerInstructions: "Observe the assigned Lead.",
        },
        contentHash: "content-hash",
        createdAt: "2026-08-03T00:00:00.000Z",
      },
    });

    assert.match(instruction, /Every human-authored turn must end with a concise visible response/);
    assert.match(instruction, /Never finish a human turn with tool activity alone/);
    assert.match(instruction, /direct bounded Peer work/);
    assert.doesNotMatch(
      instruction,
      /Do not bypass Lead, read Peer transcripts, contact Peers directly/,
    );
    assert.match(instruction, /EffectiveAuthorityReceipt: unavailable/);
    assert.match(instruction, new RegExp(`base_laws digest="${SUPERVISED_BASE_POLICY_HASH}"`));
  }),
);

it.effect("keeps Supervisor Harness Patch proposals reversible and Human-gated", () =>
  Effect.sync(() => {
    const instruction = supervisedInstructionForSession({
      role: "supervisor",
      supervisorSeatId: SupervisorSeatId.makeUnsafe("supervisor-patch"),
      leadSeatId: LeadSeatId.makeUnsafe("lead-root"),
      missionIds: [SupervisionMissionId.makeUnsafe("mission-patch")],
      agentSeatId: "supervisor-patch",
      workspaceId: "workspace-patch",
      roomIds: ["room-owned-by-lead"],
      effectiveRole: "supervisor",
      authorityReceiptId: "receipt-supervisor-patch",
      allowedTools: ["supervised.topology.read"],
      allowedCommands: ["supervised.intervention.propose"],
      rootLeaseIds: [],
      mandateIds: ["mandate-observe"],
      runPolicyRevision: 7,
      profileSnapshot: {
        id: ProfileSnapshotId.makeUnsafe("snapshot-patch"),
        sourcePresetId: null,
        sourcePresetName: "Supervisor Default",
        runtime: {
          provider: "codex",
          model: "gpt-5.6-luna",
          reasoningEffort: "low",
          sandboxMode: "danger-full-access",
          approvalPolicy: "never",
          developerInstructions: "Observe orchestration friction.",
        },
        contentHash: "content-hash-patch",
        createdAt: "2026-08-10T00:00:00.000Z",
      },
    });

    assert.match(instruction, /propose the smallest reversible Harness Patch/);
    assert.match(instruction, /grounded in durable observation evidence/);
    assert.match(instruction, /Never approve, activate, or promote a Harness Patch as the Human/);
    assert.match(instruction, /never weaken RunPolicy or mutate the server-owned base policy/);
    assert.match(instruction, /Do not claim Root ownership unless an active RootAuthorityLease/);
    assert.doesNotMatch(instruction, /You hold Root authority only for the Rooms/);
  }),
);

it.effect("preserves Lead Root authority independently of the Supervisor patch protocol", () =>
  Effect.sync(() => {
    const instruction = supervisedInstructionForSession({
      role: "lead",
      leadSeatId: LeadSeatId.makeUnsafe("lead-root"),
      missionIds: [SupervisionMissionId.makeUnsafe("mission-lead")],
      agentSeatId: "lead-root",
      workspaceId: "workspace-lead",
      roomIds: ["room-lead"],
      effectiveRole: "acting_root",
      authorityReceiptId: "receipt-lead-root",
      allowedTools: ["supervised.tasks.list"],
      allowedCommands: ["supervised.task.accept"],
      rootLeaseIds: ["lease-lead-root"],
      mandateIds: ["mandate-lead"],
      runPolicyRevision: 8,
      profileSnapshot: {
        id: ProfileSnapshotId.makeUnsafe("snapshot-lead"),
        sourcePresetId: null,
        sourcePresetName: "Lead Default",
        runtime: {
          provider: "codex",
          model: "gpt-5.6-luna",
          reasoningEffort: "low",
          sandboxMode: "danger-full-access",
          approvalPolicy: "never",
          developerInstructions: "Own the Room outcome.",
        },
        contentHash: "content-hash-lead",
        createdAt: "2026-08-10T00:00:00.000Z",
      },
    });

    assert.match(instruction, /role="lead"/);
    assert.match(instruction, /You hold Root authority only for the Rooms and RootAuthorityLeases/);
    assert.match(instruction, /Supervisor advice does not remove your authority/);
    assert.match(instruction, /Root leases: lease-lead-root/);
    assert.doesNotMatch(instruction, /Never approve, activate, or promote a Harness Patch/);
  }),
);
