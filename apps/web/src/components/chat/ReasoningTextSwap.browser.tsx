// FILE: ReasoningTextSwap.browser.tsx
// Purpose: Browser regression for turn-scoped provider reasoning handoff.
// Layer: Vitest browser tests

import "../../index.css";

import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ReasoningTextSwap } from "./ReasoningTextSwap";

function Harness() {
  const [providerPhrase, setProviderPhrase] = useState<string | null>(null);
  const [scopeKey, setScopeKey] = useState("turn-1");
  return (
    <div>
      <button
        type="button"
        onClick={() =>
          setProviderPhrase(
            scopeKey === "turn-1"
              ? "Planning README inspection strategy"
              : "Inspecting the current request",
          )
        }
      >
        Emit provider summary
      </button>
      <button type="button" onClick={() => setProviderPhrase(null)}>
        Drop projected summary
      </button>
      <button
        type="button"
        onClick={() => {
          setProviderPhrase(null);
          setScopeKey("turn-2");
        }}
      >
        Start next turn
      </button>
      <ReasoningTextSwap active scopeKey={scopeKey} providerPhrase={providerPhrase} />
    </div>
  );
}

describe("ReasoningTextSwap", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("retains a summary within one turn and clears it at the next turn boundary", async () => {
    const screen = await render(<Harness />);
    try {
      const root = document.querySelector<HTMLElement>('[data-reasoning-text-swap="true"]');
      expect(root).not.toBeNull();
      expect(root?.dataset.reasoningSource).toBe("synthetic");
      expect(root?.textContent).toContain("Thinking…");

      await page.getByRole("button", { name: "Emit provider summary" }).click();
      await expect
        .poll(
          () =>
            document.querySelector<HTMLElement>('[data-reasoning-text-swap="true"]')
              ?.textContent,
        )
        .toContain("Planning README inspection strategy");

      expect(document.querySelector('[data-reasoning-text-swap="true"]')).toBe(root);
      expect(root?.dataset.reasoningSource).toBe("provider");
      expect(document.querySelector('[data-reasoning-activity-stream="true"]')).toBeNull();

      await page.getByRole("button", { name: "Drop projected summary" }).click();
      await expect.poll(() => root?.dataset.reasoningSource).toBe("provider");
      expect(root?.textContent).toContain("Planning README inspection strategy");

      await page.getByRole("button", { name: "Start next turn" }).click();
      await expect
        .poll(() => document.querySelector<HTMLElement>('[data-reasoning-text-swap="true"]'))
        .not.toBe(root);
      const resetRoot = document.querySelector<HTMLElement>(
        '[data-reasoning-text-swap="true"]',
      );
      expect(resetRoot?.dataset.reasoningSource).toBe("synthetic");
      expect(resetRoot?.textContent).toContain("Thinking…");
      expect(resetRoot?.textContent).not.toContain("Planning README inspection strategy");
      await page.getByRole("button", { name: "Emit provider summary" }).click();
      await expect
        .poll(
          () =>
            document.querySelector<HTMLElement>('[data-reasoning-text-swap="true"]')
              ?.textContent,
        )
        .toContain("Inspecting the current request");
      const nextTurnRoot = document.querySelector<HTMLElement>(
        '[data-reasoning-text-swap="true"]',
      );
      expect(nextTurnRoot).not.toBe(root);
      expect(nextTurnRoot?.dataset.reasoningSource).toBe("provider");
      expect(nextTurnRoot?.textContent).not.toContain("Planning README inspection strategy");
    } finally {
      await screen.unmount();
    }
  });
});
