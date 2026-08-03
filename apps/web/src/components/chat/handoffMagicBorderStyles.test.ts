import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("handoff magic border geometry", () => {
  it("keeps the stroke and glow on the composer rail's real corner shape", () => {
    const sharedPseudoRule = styles.match(
      /\.handoff-magic-border::before,\s*\.handoff-magic-border::after\s*\{([\s\S]*?)\n\s*\}/,
    )?.[1];

    expect(sharedPseudoRule).toBeDefined();
    expect(sharedPseudoRule).toContain("border-radius: inherit");
    expect(sharedPseudoRule).toContain("corner-shape: inherit");
    expect(sharedPseudoRule).toContain("-electron-corner-smoothing: inherit");
  });
});
