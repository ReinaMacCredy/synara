import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Schema } from "effect";

import { SupervisedToolInvocationReceipt } from "./supervisedTools";

describe("Supervised tool contracts", () => {
  it("round-trips a durable projected receipt", () => {
    const receipt = Schema.decodeUnknownSync(SupervisedToolInvocationReceipt)({
      id: "tool-receipt-1",
      toolId: "supervised.topology.read",
      providerToolName: "read_supervision_state",
      schemaVersion: "1.0.0",
      actorSeatId: "supervisor-1",
      authorityReceiptId: "authority-1",
      workspaceId: "workspace-1",
      roomId: null,
      callerThreadId: "thread-1",
      callerTurnId: "turn-1",
      state: "projected",
      requestedAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-08-09T00:00:01.000Z",
      errorCode: null,
      errorMessage: null,
    });

    assert.equal(receipt.toolId, "supervised.topology.read");
    assert.equal(receipt.state, "projected");
  });

  it("accepts the Stage 5 shared-notebook append intent", () => {
    const receipt = Schema.decodeUnknownSync(SupervisedToolInvocationReceipt)({
      id: "tool-receipt-stage-5",
      toolId: "supervised.notebook.append",
      providerToolName: "append_supervisor_notebook_entry",
      schemaVersion: "1.0.0",
      actorSeatId: "supervisor-1",
      authorityReceiptId: "authority-1",
      workspaceId: "workspace-1",
      roomId: null,
      callerThreadId: "thread-1",
      callerTurnId: "turn-1",
      state: "projected",
      requestedAt: "2026-08-09T00:00:00.000Z",
      completedAt: "2026-08-09T00:00:01.000Z",
      errorCode: null,
      errorMessage: null,
    });

    assert.equal(receipt.toolId, "supervised.notebook.append");
  });
});
