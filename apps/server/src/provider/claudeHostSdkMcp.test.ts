import assert from "node:assert/strict";

import type { HostToolDefinition } from "../orchestration/hostTools/runtime.ts";
import { describe, it } from "vitest";

import { claudeSupportedHostToolDefinitions } from "./claudeHostSdkMcp.ts";

const definition = (
  name: string,
  claude: HostToolDefinition["providerSupport"]["claude"],
): HostToolDefinition => ({
  name,
  displayName: name,
  description: name,
  inputSchema: { type: "object" },
  readOnly: true,
  providerSupport: { codex: "native", claude },
});

describe("Claude host SDK MCP", () => {
  it("fails closed by excluding unsupported governed tools", () => {
    const supported = claudeSupportedHostToolDefinitions([
      definition("supported", "native"),
      definition("unsupported", "unsupported"),
    ]);

    assert.deepStrictEqual(
      supported.map((entry) => entry.name),
      ["supported"],
    );
  });
});
