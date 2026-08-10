import assert from "node:assert/strict";

import {
  AgentSeatId,
  EffectiveAuthorityReceiptId,
  RoomId,
  SupervisedToolInvocationReceiptId,
  SupervisedWorkspaceId,
  TaskNodeId,
  type EffectiveAuthorityReceipt,
  type SupervisedToolInvocationReceipt,
  type SupervisedToolPolicy,
} from "@synara/contracts";
import { describe, it } from "vitest";

import type { HostToolDefinition } from "../../orchestration/hostTools/runtime.ts";
import type { SupervisedIntentToolDescriptor } from "../tools/Registry.ts";
import { projectSupervisedSystemTools } from "./SupervisedSettingsProjection.ts";

const now = "2026-08-09T10:00:00.000Z";
const toolId = "supervised.topology.read" as const;
const workspaceId = SupervisedWorkspaceId.makeUnsafe("workspace-1");
const roomId = RoomId.makeUnsafe("room-1");
const taskNodeId = TaskNodeId.makeUnsafe("task-node-1");
const authorityReceiptId = EffectiveAuthorityReceiptId.makeUnsafe("authority-1");

const descriptor: SupervisedIntentToolDescriptor = {
  id: toolId,
  schemaVersion: "1.0.0",
  roles: ["supervisor"],
  readOnly: true,
  internalCommands: [],
};

const definition: HostToolDefinition = {
  name: "supervised_topology_read",
  displayName: "Read topology",
  description: "Read the governed topology.",
  inputSchema: {},
  readOnly: true,
  providerSupport: { codex: "native", claude: "unsupported" },
  supervised: { toolId, schemaVersion: "1.0.0" },
};

const authorityReceipt: EffectiveAuthorityReceipt = {
  id: authorityReceiptId,
  actorSeatId: AgentSeatId.makeUnsafe("seat-1"),
  identityRole: "supervisor",
  effectiveRole: "supervisor",
  workspaceScopes: [workspaceId],
  roomScopes: [roomId],
  taskNodeScopes: [taskNodeId],
  allowedCommands: [],
  allowedTools: [toolId],
  rootLeaseIds: [],
  mandateIds: [],
  runPolicyRevision: 3,
  issuedAt: "2026-08-09T09:00:00.000Z",
  expiresAt: null,
  revokedAt: null,
};

const receipt = (
  id: string,
  state: SupervisedToolInvocationReceipt["state"],
  requestedAt: string,
): SupervisedToolInvocationReceipt => ({
  id: SupervisedToolInvocationReceiptId.makeUnsafe(id),
  toolId,
  providerToolName: definition.name,
  schemaVersion: "1.0.0",
  actorSeatId: authorityReceipt.actorSeatId,
  authorityReceiptId,
  workspaceId,
  roomId,
  callerThreadId: "thread-1",
  callerTurnId: "turn-1",
  state,
  requestedAt,
  completedAt: requestedAt,
  errorCode: state === "failed" ? "failed" : null,
  errorMessage: state === "failed" ? "Failure" : null,
});

describe("Supervised settings tool projection", () => {
  it("projects active scope grants, adapter health, and bounded receipt evidence", () => {
    const tools = projectSupervisedSystemTools({
      registry: [descriptor],
      definitions: [definition],
      policies: [],
      receipts: [
        receipt("receipt-latest", "projected", "2026-08-09T09:50:00.000Z"),
        receipt("receipt-older", "failed", "2026-08-09T09:40:00.000Z"),
      ],
      authorityReceipts: [authorityReceipt],
      defaultUpdatedAt: now,
      at: now,
    });

    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.health, "healthy");
    assert.deepEqual(tools[0]?.allowedScopes, {
      workspaceIds: [workspaceId],
      roomIds: [roomId],
      taskNodeIds: [taskNodeId],
    });
    assert.equal(tools[0]?.lastInvocation?.id, "receipt-latest");
    assert.equal(tools[0]?.successCount, 1);
    assert.equal(tools[0]?.failureCount, 1);
  });

  it("shows durable owner policy and excludes expired authority from allowed scopes", () => {
    const revoked: SupervisedToolPolicy = {
      toolId,
      state: "revoked",
      revision: 2,
      reason: "Owner revoked the adapter.",
      updatedAt: now,
      revokedAt: now,
    };
    const [tool] = projectSupervisedSystemTools({
      registry: [descriptor],
      definitions: [],
      policies: [revoked],
      receipts: [],
      authorityReceipts: [{ ...authorityReceipt, expiresAt: "2026-08-09T09:59:59.000Z" }],
      defaultUpdatedAt: now,
      at: now,
    });

    assert.equal(tool?.health, "revoked");
    assert.equal(tool?.policy.revision, 2);
    assert.deepEqual(tool?.allowedScopes, {
      workspaceIds: [],
      roomIds: [],
      taskNodeIds: [],
    });
  });

  it("groups every provider adapter under its canonical intent instead of choosing one", () => {
    const alternateDefinition: HostToolDefinition = {
      ...definition,
      name: "supervised_topology_export",
      displayName: "Export topology",
    };
    const [tool] = projectSupervisedSystemTools({
      registry: [descriptor],
      definitions: [definition, alternateDefinition],
      policies: [],
      receipts: [],
      authorityReceipts: [],
      defaultUpdatedAt: now,
      at: now,
    });

    assert.equal(tool?.displayName, toolId);
    assert.deepEqual(tool?.providerToolNames, [
      "supervised_topology_read",
      "supervised_topology_export",
    ]);
    assert.match(tool?.description ?? "", /2 provider-facing adapters/);
    assert.equal(tool?.health, "healthy");
  });
});
