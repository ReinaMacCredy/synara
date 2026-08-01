import {
  ProjectId,
  TaskProcessId,
  ThreadId,
  type OrchestratorOwnershipEdge,
} from "@synara/contracts";
import { describe, expect, it } from "vitest";

import type { ProjectionOrchestratorCore } from "../persistence/Services/ProjectionOrchestrator.ts";
import {
  canReadOrchestratorThread,
  resolveOrchestratorCallerAuthority,
  visibleOrchestratorToolNames,
} from "./orchestratorToolPolicy.ts";

const createdAt = "2026-08-01T00:00:00.000Z";
const rootThreadId = ThreadId.makeUnsafe("root");
const childOwnerId = ThreadId.makeUnsafe("child-owner");
const descendantId = ThreadId.makeUnsafe("descendant");
const participantId = ThreadId.makeUnsafe("participant");

const edge = (input: {
  parent: typeof rootThreadId;
  child: typeof rootThreadId;
  role: OrchestratorOwnershipEdge["role"];
  capabilities: OrchestratorOwnershipEdge["capabilities"];
}): OrchestratorOwnershipEdge => ({
  rootThreadId,
  parentThreadId: input.parent,
  childThreadId: input.child,
  role: input.role,
  capabilities: input.capabilities,
  contractVersion: 1,
  sourceThreadId: rootThreadId,
  sourceTurnId: null,
  sourceOperationId: null,
  activeFrom: createdAt,
  retiredAt: null,
  decisionReason: {
    summary: "Independent work",
    taskFit: ["implementation"],
    contextHealth: "healthy",
    cacheEconomics: "unknown",
    selectedAt: createdAt,
  },
});

const core: ProjectionOrchestratorCore = {
  root: {
    root: {
      rootThreadId,
      projectId: ProjectId.makeUnsafe("project"),
      protocolVersion: 1,
      state: "active",
      activeProcessId: TaskProcessId.makeUnsafe("process"),
      resourcePolicyVersion: 1,
      createdAt,
      archivedAt: null,
      revision: 4,
    },
    highWaterCursor: "10",
  },
  ownershipEdges: [
    edge({
      parent: rootThreadId,
      child: childOwnerId,
      role: "child_owner",
      capabilities: [
        "state.read",
        "subtree.read",
        "child.assign",
        "child.retire",
        "link.request",
        "message.send",
        "artifact.publish",
        "assignment.report",
      ],
    }),
    edge({
      parent: childOwnerId,
      child: descendantId,
      role: "participant",
      capabilities: [
        "state.read",
        "link.request",
        "message.send",
        "artifact.publish",
        "assignment.report",
      ],
    }),
    edge({
      parent: rootThreadId,
      child: participantId,
      role: "participant",
      capabilities: [
        "state.read",
        "link.request",
        "message.send",
        "artifact.publish",
        "assignment.report",
      ],
    }),
  ],
  communicationLinks: [],
  assignments: [],
  runs: [],
  providerCapabilities: [],
  capacity: null,
};

describe("Orchestrator tool policy", () => {
  it("shows the exact V1 catalog according to durable role capabilities", () => {
    const root = resolveOrchestratorCallerAuthority({ core, callerThreadId: rootThreadId })!;
    expect(visibleOrchestratorToolNames(root)).toHaveLength(18);
    expect(visibleOrchestratorToolNames(root)).not.toContain("synara_orchestrator_detach");

    const participant = resolveOrchestratorCallerAuthority({
      core,
      callerThreadId: participantId,
    })!;
    expect(visibleOrchestratorToolNames(participant)).toEqual([
      "synara_task_process_get",
      "synara_orchestrator_get_state",
      "synara_orchestrator_send_message",
      "synara_orchestrator_request_link",
      "synara_orchestrator_publish_artifact",
      "synara_orchestrator_report_status",
      "synara_orchestrator_request_change",
      "synara_orchestrator_wait",
    ]);
  });

  it("uses Orchestrator ownership, not provider parentage, for subtree reads", () => {
    const owner = resolveOrchestratorCallerAuthority({ core, callerThreadId: childOwnerId })!;
    expect(canReadOrchestratorThread(owner, descendantId)).toBe(true);
    expect(canReadOrchestratorThread(owner, participantId)).toBe(false);
  });
});
