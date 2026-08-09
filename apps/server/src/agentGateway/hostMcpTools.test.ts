import assert from "node:assert/strict";

import { Effect } from "effect";
import { describe, it } from "vitest";

import type { HostToolRuntimeShape } from "../orchestration/Services/HostToolRuntime.ts";
import type { HostToolDefinition } from "../orchestration/hostTools/runtime.ts";
import { makeAgentGatewayHostTools } from "./hostMcpTools.ts";
import type { ToolContext } from "./toolRuntime.ts";

const definition = (name: string): HostToolDefinition => ({
  name,
  displayName: name,
  description: name,
  inputSchema: { type: "object" },
  readOnly: true,
  providerSupport: { codex: "native", claude: "unsupported" },
});

describe("Agent Gateway host tools", () => {
  it("loads the visible catalog once per gateway request context", async () => {
    const catalog = [definition("one"), definition("two"), definition("three")];
    let listCalls = 0;
    const runtime: HostToolRuntimeShape = {
      catalog,
      list: () =>
        Effect.sync(() => {
          listCalls += 1;
          return catalog;
        }),
      execute: () => Effect.succeed({ ok: true, value: null }),
    };
    const context = {
      principal: {
        kind: "provider-session",
        sessionKey: "session-1",
        threadId: "thread-1",
        provider: "codex",
        turnId: "turn-1",
      },
      callerThreadId: "thread-1",
      callerSessionKey: "session-1",
      callerProvider: "codex",
      callerCapabilities: new Set(["thread:read"]),
      callerTurnId: "turn-1",
      assertCallerTurnActive: () => Effect.void,
    } as Omit<ToolContext, "jsonRpcRequestId">;

    const visible = await Effect.runPromise(
      Effect.forEach(makeAgentGatewayHostTools({ runtime }), (entry) => entry.isVisible!(context)),
    );

    assert.deepStrictEqual(visible, [true, true, true]);
    assert.equal(listCalls, 1);
  });
});
