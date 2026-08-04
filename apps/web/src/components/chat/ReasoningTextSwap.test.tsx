import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  advanceReasoningSwapState,
  INITIAL_REASONING_SWAP_STATE,
  ReasoningTextSwap,
  REASONING_TEXT_SWAP_INTERVAL_MS,
  REASONING_TEXT_SWAP_PHRASES,
} from "./ReasoningTextSwap";

describe("ReasoningTextSwap", () => {
  it("cycles through the selected Swap phrases and wraps to Thinking", () => {
    const observed = [
      REASONING_TEXT_SWAP_PHRASES[INITIAL_REASONING_SWAP_STATE.index],
    ];
    let state = INITIAL_REASONING_SWAP_STATE;

    for (let index = 0; index < REASONING_TEXT_SWAP_PHRASES.length; index += 1) {
      state = advanceReasoningSwapState(state);
      observed.push(REASONING_TEXT_SWAP_PHRASES[state.index]);
    }

    expect(REASONING_TEXT_SWAP_INTERVAL_MS).toBe(1_800);
    expect(observed).toEqual([
      "Thinking",
      "Reading the request",
      "Working through the details",
      "Preparing the answer",
      "Thinking",
    ]);
  });

  it("renders a stable longest-phrase slot and polite current status", () => {
    const markup = renderToStaticMarkup(<ReasoningTextSwap active />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Working through the details…");
    expect(markup).toContain("Thinking…");
    expect(markup).toContain(">Thinking<");
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
