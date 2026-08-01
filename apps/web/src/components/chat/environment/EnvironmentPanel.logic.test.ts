import { describe, expect, it } from "vitest";

import { shouldRenderEnvironmentProgress } from "./EnvironmentPanel.logic";

describe("Environment progress visibility", () => {
  it("keeps completion visible and hides only a missing binding projection", () => {
    expect(shouldRenderEnvironmentProgress(null)).toBe(false);
    expect(shouldRenderEnvironmentProgress({ completedCount: 5, totalCount: 5 } as never)).toBe(
      true,
    );
  });
});
