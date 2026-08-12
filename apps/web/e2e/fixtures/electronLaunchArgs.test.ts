import { describe, expect, it } from "vitest";

import { electronE2eLaunchArgs } from "./electronLaunchArgs";

describe("electronE2eLaunchArgs", () => {
  it("disables the unavailable SUID sandbox on Linux runners", () => {
    expect(electronE2eLaunchArgs("fixture.cjs", "linux")).toEqual(["--no-sandbox", "fixture.cjs"]);
  });

  it("preserves the sandbox defaults on macOS and Windows", () => {
    expect(electronE2eLaunchArgs("fixture.cjs", "darwin")).toEqual(["fixture.cjs"]);
    expect(electronE2eLaunchArgs("fixture.cjs", "win32")).toEqual(["fixture.cjs"]);
  });
});
