import { describe, expect, it } from "vitest";

import { codexDynamicToolResponse } from "./codexDynamicToolResponse.ts";

describe("codexDynamicToolResponse", () => {
  it("returns domain validation failures as handled tool output", () => {
    const response = codexDynamicToolResponse({
      ok: false,
      error: {
        code: "handoff_input_invalid",
        message: "'limit' must be an integer between 1 and 50.",
      },
    });

    expect(response.success).toBe(true);
    expect(JSON.parse(response.contentItems[0]!.text)).toEqual({
      ok: false,
      error: {
        code: "handoff_input_invalid",
        message: "'limit' must be an integer between 1 and 50.",
      },
    });
  });

  it("includes the durable audit receipt without hiding the existing result fields", () => {
    const response = codexDynamicToolResponse({
      ok: true,
      value: { sequence: 42 },
      receipt: {
        id: "tool-receipt-1" as never,
        toolId: "supervised.topology.read",
        providerToolName: "read_supervision_state",
        schemaVersion: "1.0.0",
        actorSeatId: null,
        authorityReceiptId: null,
        workspaceId: null,
        roomId: null,
        callerThreadId: "thread-1",
        callerTurnId: null,
        state: "projected",
        requestedAt: "2026-08-09T00:00:00.000Z",
        completedAt: "2026-08-09T00:00:01.000Z",
        errorCode: null,
        errorMessage: null,
      },
    });

    expect(JSON.parse(response.contentItems[0]!.text)).toMatchObject({
      sequence: 42,
      _synaraReceipt: {
        toolId: "supervised.topology.read",
        state: "projected",
      },
    });
  });
});
