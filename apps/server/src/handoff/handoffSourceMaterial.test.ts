import { describe, expect, it } from "vitest";

import { canonicalHandoffSourceItems } from "./handoffSourceMaterial.ts";

describe("canonicalHandoffSourceItems", () => {
  it("keeps the established message ref stable for frozen digest reconstruction", () => {
    const items = canonicalHandoffSourceItems([
      {
        id: "msg-1",
        role: "assistant",
        text: "Continue from this result",
        createdAt: "2026-08-02T00:00:00.000Z",
      },
    ]);

    expect(items[0]?.ref).toBe("message:msg-1");
  });
});
