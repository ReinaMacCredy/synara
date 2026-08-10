import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { makeSupervisedTools } from "./toolRegistry.ts";

describe("Supervised host tool metadata", () => {
  it("classifies the bounded Supervised state reader as read-only", () => {
    const tools = makeSupervisedTools({} as never);
    const readState = tools.find(
      (tool) => tool.definition.name === "read_supervised_state",
    );
    assert.equal(readState?.definition.readOnly, true);
  });

  it("exposes the canonical Peer tool and no legacy Specialist alias", () => {
    const names = makeSupervisedTools({} as never).map((tool) => tool.definition.name);
    assert.ok(names.includes("create_peer"));
    assert.ok(!names.includes("create_specialist"));
    assert.ok(!names.some((name) => name.includes("supervision")));
  });

  it("exposes typed Supervisor Lead-Room and Lead Task-Graph mutations", () => {
    const tools = makeSupervisedTools({} as never);
    const createLeadRoom = tools.find(
      (tool) => tool.definition.name === "create_lead_room",
    );
    const createTaskGraph = tools.find(
      (tool) => tool.definition.name === "create_task_graph",
    );

    assert.equal(createLeadRoom?.definition.supervised?.toolId, "supervised.agent.create");
    assert.equal(createTaskGraph?.definition.supervised?.toolId, "supervised.task.delegate");
    assert.equal(createLeadRoom?.definition.readOnly, false);
    assert.equal(createTaskGraph?.definition.readOnly, false);
  });

  it("exposes the direct Peer-work lifecycle through canonical intent tools", () => {
    const tools = makeSupervisedTools({} as never);
    const createPeer = tools.find((tool) => tool.definition.name === "create_peer");
    const assignPeerWork = tools.find(
      (tool) => tool.definition.name === "assign_peer_work",
    );
    const publishPeerEvidence = tools.find(
      (tool) => tool.definition.name === "publish_peer_evidence",
    );
    const reconcilePeerIntervention = tools.find(
      (tool) => tool.definition.name === "reconcile_peer_intervention",
    );

    assert.equal(createPeer?.definition.supervised?.toolId, "supervised.agent.create");
    assert.equal(assignPeerWork?.definition.supervised?.toolId, "supervised.work.assign");
    assert.equal(
      publishPeerEvidence?.definition.supervised?.toolId,
      "supervised.evidence.publish",
    );
    assert.equal(
      reconcilePeerIntervention?.definition.supervised?.toolId,
      "supervised.intervention.reconcile",
    );
    assert.equal(assignPeerWork?.definition.readOnly, false);
    assert.equal(publishPeerEvidence?.definition.readOnly, false);
    assert.deepEqual(
      assignPeerWork?.definition.inputSchema.required,
      ["roomId", "peerThreadId", "workRequest"],
    );
  });
});
