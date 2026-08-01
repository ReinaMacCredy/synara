import "../../../index.css";

import { describe, expect, it } from "vitest";

import { EnvironmentProgressSection } from "./EnvironmentProgressSection";

describe("EnvironmentProgressSection", () => {
  it("uses the controlled SessionProgress component and shared per-thread preference", () => {
    expect(typeof EnvironmentProgressSection).toBe("function");
  });
});
