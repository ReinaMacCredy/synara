import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { makeSupervisionTools } from "./toolRegistry.ts";

describe("Supervision host tool metadata", () => {
  it("classifies the bounded supervision state reader as read-only", () => {
    const tools = makeSupervisionTools({} as never);
    const readState = tools.find(
      (tool) => tool.definition.name === "read_supervision_state",
    );
    assert.equal(readState?.definition.readOnly, true);
  });
});
