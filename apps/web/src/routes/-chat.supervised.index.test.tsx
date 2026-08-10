import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./_chat.supervised.index.tsx", import.meta.url), "utf8");

describe("Supervised draft route", () => {
  it("marks the Primary Supervisor chat as supervised without creating a client Room", () => {
    const deferredChatView = source.match(/<DeferredChatView[\s\S]*?\/>/)?.[0];

    expect(deferredChatView).toContain("supervisedMode");
    expect(source).not.toContain("ensureSupervisedRoom");
    expect(source).toContain("primarySupervisorThreadId");
    expect(source).toContain("resolvePrimarySupervisorThreadId(supervisedSeats)");
    expect(source).not.toContain("seat.projectId === selectedProject.id");
  });
});
