// FILE: ReasoningActivityStream.browser.tsx
// Purpose: Browser regression for capped live reasoning follow motion.
// Layer: Vitest browser tests

import "../../index.css";

import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { WorkLogEntry } from "../../session-logic";
import {
  ReasoningActivityStream,
  REASONING_ACTIVITY_MAX_HEIGHT_PX,
} from "./ReasoningActivityStream";

const firstEntry: WorkLogEntry = {
  id: "reasoning-live",
  createdAt: "2026-08-04T00:00:00.000Z",
  label: "Reasoning trace",
  toolTitle: "Reasoning trace",
  detail: "Reading the request.",
  tone: "tool",
};

function Harness() {
  const [entries, setEntries] = useState<WorkLogEntry[]>([firstEntry]);
  return (
    <div className="w-[320px]">
      <button
        type="button"
        onClick={() =>
          setEntries([
            firstEntry,
            {
              ...firstEntry,
              id: "reasoning-more",
              detail: Array.from(
                { length: 18 },
                (_, index) => `Reasoning update ${index + 1}: checking the implementation details.`,
              ).join("\n\n"),
            },
          ])
        }
      >
        Stream more
      </button>
      <ReasoningActivityStream
        entries={entries}
        fontSize={14}
        markdownCwd={undefined}
        onImageExpand={() => {}}
      />
    </div>
  );
}

describe("ReasoningActivityStream", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps one viewport and follows accumulated text with a transform", async () => {
    const screen = await render(<Harness />);
    try {
      const root = document.querySelector<HTMLElement>('[data-reasoning-activity-stream="true"]');
      const viewport = document.querySelector<HTMLElement>(
        '[data-reasoning-activity-viewport="true"]',
      );
      expect(root).not.toBeNull();
      expect(viewport).not.toBeNull();

      await page.getByRole("button", { name: "Stream more" }).click();
      await expect
        .poll(() =>
          document
            .querySelector<HTMLElement>('[data-reasoning-activity-content="true"]')
            ?.style.transform.startsWith("translateY(-"),
        )
        .toBe(true);

      expect(document.querySelector('[data-reasoning-activity-stream="true"]')).toBe(root);
      expect(viewport!.clientHeight).toBeLessThanOrEqual(REASONING_ACTIVITY_MAX_HEIGHT_PX);
      expect(viewport!.scrollHeight).toBeGreaterThan(viewport!.clientHeight);
    } finally {
      await screen.unmount();
    }
  });
});
