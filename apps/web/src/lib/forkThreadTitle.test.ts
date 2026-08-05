import { describe, expect, it } from "vitest";

import { buildForkedThreadTitle, parseForkThreadTitleBase } from "./forkThreadTitle";

describe("forkThreadTitle", () => {
  it("parses bare titles as number 1", () => {
    expect(parseForkThreadTitleBase("Hi")).toEqual({ base: "Hi", number: 1 });
    expect(parseForkThreadTitleBase("Hi (2)")).toEqual({ base: "Hi", number: 2 });
    expect(parseForkThreadTitleBase("  Fix auth (12) ")).toEqual({
      base: "Fix auth",
      number: 12,
    });
  });

  it("names the first fork Hi (2)", () => {
    expect(buildForkedThreadTitle("Hi", ["Hi"])).toBe("Hi (2)");
    expect(buildForkedThreadTitle("Hi", [])).toBe("Hi (2)");
  });

  it("chains Hi (2) → Hi (3) and fills the next free number in the family", () => {
    expect(buildForkedThreadTitle("Hi (2)", ["Hi", "Hi (2)"])).toBe("Hi (3)");
    expect(buildForkedThreadTitle("Hi", ["Hi", "Hi (2)", "Hi (3)"])).toBe("Hi (4)");
  });
});
