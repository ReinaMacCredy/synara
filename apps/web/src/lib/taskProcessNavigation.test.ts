import { TaskProcessId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { resolveTaskProcessNavigationTarget } from "./taskProcessNavigation";

describe("resolveTaskProcessNavigationTarget", () => {
  const processId = TaskProcessId.makeUnsafe("process-1");

  it("keeps user-owned task plans on the Projects route", () => {
    expect(resolveTaskProcessNavigationTarget(processId, { kind: "user" })).toEqual({
      mode: "project",
      processId,
    });
  });
});
