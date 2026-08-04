import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReasoningTextSwap } from "./ReasoningTextSwap";

describe("ReasoningTextSwap", () => {
  it("renders only Thinking before the current turn emits a provider summary", () => {
    const markup = renderToStaticMarkup(
      <ReasoningTextSwap active scopeKey="turn-without-summary" />,
    );

    expect(markup).toContain('data-reasoning-source="synthetic"');
    expect(markup).toContain("Thinking…");
    expect(markup).not.toContain("Reading the request");
    expect(markup).not.toContain("Working through the details");
    expect(markup).not.toContain("Preparing the answer");
  });

  it("starts directly on the current turn provider summary", () => {
    const markup = renderToStaticMarkup(
      <ReasoningTextSwap
        active
        scopeKey="turn-with-summary"
        providerPhrase="Planning README inspection strategy"
      />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('data-reasoning-source="provider"');
    expect(markup).toContain("Planning README inspection strategy");
    expect(markup).not.toContain("Thinking…");
  });

  it("renders nothing when the turn is not active", () => {
    const markup = renderToStaticMarkup(
      <ReasoningTextSwap
        active={false}
        scopeKey="settled-turn"
        providerPhrase="Completed reasoning"
      />,
    );

    expect(markup).toBe("");
  });

  it("keeps the beUI Swap motion and reduced-motion contracts", () => {
    const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

    expect(css).toContain("transform: translateY(3px)");
    expect(css).toContain("transform: translateY(-3px)");
    expect(css).toContain(
      "animation: reasoning-text-swap-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
    );
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-name: reasoning-text-swap-fade-in");
    expect(css).toContain("animation-duration: 120ms");
  });
});
