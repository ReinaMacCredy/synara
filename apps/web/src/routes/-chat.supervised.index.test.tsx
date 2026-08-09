import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./_chat.supervised.index.tsx", import.meta.url), "utf8");

describe("Supervised draft route", () => {
  it("marks the draft chat as supervised so its first send activates the Room", () => {
    const deferredChatView = source.match(/<DeferredChatView[\s\S]*?\/>/)?.[0];

    expect(deferredChatView).toContain("supervisedMode");
  });
});
