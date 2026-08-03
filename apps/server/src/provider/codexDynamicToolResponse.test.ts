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
});
