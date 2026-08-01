import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ComposerSessionProgress } from "./ComposerSessionProgress";

describe("ComposerSessionProgress", () => {
  it("is a canonical Process wrapper rather than a provider ActiveTaskList alias", () => {
    const source = readFileSync(new URL("./ComposerSessionProgress.tsx", import.meta.url), "utf8");
    expect(typeof ComposerSessionProgress).toBe("function");
    expect(source).toContain("data-canonical-task-process");
    expect(source).not.toContain("ActiveTaskListState");
    expect(source).not.toContain("ActiveTaskListCard");
  });
});
