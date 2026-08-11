import assert from "node:assert/strict";

import { describe, it } from "vitest";
import { Effect } from "effect";

import {
  CommandId,
  ProfilePresetId,
  SupervisedGovernanceAggregateId,
  emptySupervisedOrchestrationSnapshot,
  type SupervisedGovernanceDomainEvent,
} from "@veylen/contracts";

import { decideSupervisedGovernanceCommand } from "./governanceDecider.ts";
import { projectSupervisedGovernanceEvent } from "./governanceProjection.ts";
import { emptySupervisedGovernanceDecisionState } from "./governanceState.ts";

const now = "2026-08-09T00:00:00.000Z";

describe("canonical Supervised governance decider", () => {
  it("emits and projects only canonical Supervised profile events", async () => {
    const profile = {
      id: ProfilePresetId.makeUnsafe("profile-peer-security"),
      name: "Peer Security",
      roleHints: ["peer" as const],
      runtime: {
        provider: "codex" as const,
        model: "gpt-5.6-luna",
        reasoningEffort: "low",
        sandboxMode: "workspace-write" as const,
        approvalPolicy: "on-request" as const,
        developerInstructions: "Review the assigned security boundary.",
      },
      isDefault: false,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      revision: 0,
    };
    const event = await Effect.runPromise(
      decideSupervisedGovernanceCommand({
        state: emptySupervisedGovernanceDecisionState(now),
        command: {
          type: "supervised.profile.create",
          commandId: CommandId.makeUnsafe("command-1"),
          aggregateId: SupervisedGovernanceAggregateId.makeUnsafe("supervised"),
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: 0,
          createdAt: now,
          profile,
        },
      }),
    );
    assert.ok(!Array.isArray(event));
    const singleEvent = event as Omit<SupervisedGovernanceDomainEvent, "sequence">;
    assert.equal(singleEvent.aggregateKind, "supervised_governance");
    assert.equal(singleEvent.type, "supervised.profile-created");
    assert.equal(singleEvent.metadata.schemaVersion, "supervised-governance/v1");

    const projected = projectSupervisedGovernanceEvent(emptySupervisedOrchestrationSnapshot(now), {
      ...singleEvent,
      sequence: 1,
    });
    assert.deepStrictEqual(
      projected.profiles.map((candidate) => candidate.id),
      [profile.id],
    );
    assert.equal(projected.revision, 1);

    assert.throws(
      () =>
        projectSupervisedGovernanceEvent(emptySupervisedOrchestrationSnapshot(now), {
          ...singleEvent,
          sequence: 2,
          metadata: { schemaVersion: "supervised-governance/v2" },
        }),
      /Unsupported Supervised governance event schema/,
    );
  });
});
