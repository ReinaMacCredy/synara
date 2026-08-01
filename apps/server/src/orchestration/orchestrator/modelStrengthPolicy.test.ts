import { describe, expect, it } from "vitest";

import { MODEL_STRENGTH_POLICY_V1 } from "./modelStrengthPolicy.ts";

describe("model strength policy", () => {
  it("is a versioned data catalog without a server-side winner", () => {
    expect(MODEL_STRENGTH_POLICY_V1.version).toBe(1);
    expect(MODEL_STRENGTH_POLICY_V1.entries.length).toBeGreaterThan(1);
    expect(MODEL_STRENGTH_POLICY_V1.councilPreferences.preferDifferentFamilies).toBe(true);
    expect(Object.keys(MODEL_STRENGTH_POLICY_V1)).not.toContain("selectModel");
    expect(Object.keys(MODEL_STRENGTH_POLICY_V1)).not.toContain("ranking");
  });

  it("does not claim unavailable live telemetry", () => {
    expect(MODEL_STRENGTH_POLICY_V1.councilPreferences.unavailableTelemetryMeans).toBe("unknown");
    expect(
      MODEL_STRENGTH_POLICY_V1.entries.find((entry) => entry.provider === "gemini")?.notes[0],
    ).toContain("only when live provider capability confirms availability");
  });
});
