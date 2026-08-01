import { ProjectId, ThreadId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  assertCapabilityCeiling,
  canAdvanceRun,
  canTransitionAssignment,
  wouldCreateOwnershipCycle,
} from "./invariants.ts";
import { createEmptyOrchestratorState, type OrchestratorAggregateState } from "./projector.ts";

describe("Orchestrator invariants", () => {
  it("rejects role and parent capability escalation", () => {
    expect(() =>
      assertCapabilityCeiling({
        commandType: "orchestrator.child.attach",
        role: "compiler",
        capabilities: ["link.manage"],
      }),
    ).toThrow(OrchestrationCommandInvariantError);
    expect(() =>
      assertCapabilityCeiling({
        commandType: "orchestrator.child.attach",
        role: "child_owner",
        capabilities: ["child.assign"],
        parentCapabilities: new Set(["state.read"]),
      }),
    ).toThrow("exceeds the role or parent authority ceiling");
  });

  it("detects self and descendant ownership cycles", () => {
    const root = ThreadId.makeUnsafe("root");
    const child = ThreadId.makeUnsafe("child");
    const grandchild = ThreadId.makeUnsafe("grandchild");
    const state: OrchestratorAggregateState = {
      ...createEmptyOrchestratorState(),
      root: {
        rootThreadId: root,
        projectId: ProjectId.makeUnsafe("project"),
        protocolVersion: 1,
        state: "active",
        activeProcessId: null,
        resourcePolicyVersion: 1,
        createdAt: "2026-08-01T00:00:00.000Z",
        archivedAt: null,
        revision: 1,
      },
      ownershipEdges: [
        {
          rootThreadId: root,
          parentThreadId: root,
          childThreadId: child,
          role: "child_owner",
          capabilities: ["state.read"],
          contractVersion: 1,
          sourceThreadId: root,
          sourceTurnId: null,
          sourceOperationId: null,
          activeFrom: "2026-08-01T00:00:00.000Z",
          retiredAt: null,
          decisionReason: {
            summary: "test",
            taskFit: [],
            contextHealth: "healthy",
            cacheEconomics: "unknown",
            selectedAt: "2026-08-01T00:00:00.000Z",
          },
        },
        {
          rootThreadId: root,
          parentThreadId: child,
          childThreadId: grandchild,
          role: "participant",
          capabilities: ["state.read"],
          contractVersion: 1,
          sourceThreadId: child,
          sourceTurnId: null,
          sourceOperationId: null,
          activeFrom: "2026-08-01T00:00:00.000Z",
          retiredAt: null,
          decisionReason: {
            summary: "test",
            taskFit: [],
            contextHealth: "healthy",
            cacheEconomics: "unknown",
            selectedAt: "2026-08-01T00:00:00.000Z",
          },
        },
      ],
    };

    expect(wouldCreateOwnershipCycle({ state, childThreadId: root, parentThreadId: root })).toBe(
      true,
    );
    expect(
      wouldCreateOwnershipCycle({ state, childThreadId: child, parentThreadId: grandchild }),
    ).toBe(true);
  });

  it("keeps Council and assignment transitions explicit", () => {
    expect(canAdvanceRun("brief_sealed", "proposals_sealed")).toBe(true);
    expect(canAdvanceRun("brief_sealed", "compiled")).toBe(false);
    expect(canAdvanceRun("packet_published", "active")).toBe(false);
    expect(canTransitionAssignment("reported_complete", "verified")).toBe(true);
    expect(canTransitionAssignment("reported_complete", "accepted")).toBe(false);
  });
});
