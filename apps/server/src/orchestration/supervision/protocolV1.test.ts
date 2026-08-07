import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ProfileSnapshotId, SupervisionMissionId, SupervisorSeatId } from "@synara/contracts";
import { Effect } from "effect";

import { supervisionInstructionForSession } from "./protocolV1.ts";

it.effect("requires a visible completion after Supervisor tool activity", () =>
  Effect.sync(() => {
    const instruction = supervisionInstructionForSession({
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
  }),
);
