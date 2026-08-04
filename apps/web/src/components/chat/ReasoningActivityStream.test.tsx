import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReasoningActivityStream, reasoningActivityText } from "./ReasoningActivityStream";

const entries = [
  {
    id: "reasoning-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    label: "Reasoning trace",
    toolTitle: "Reasoning trace",
    detail: "**Reading the request**\n\n<!-- -->",
    tone: "tool" as const,
  },
  {
    id: "reasoning-2",
    createdAt: "2026-08-04T00:00:01.000Z",
    label: "Reasoning summary",
    toolTitle: "Reasoning summary",
    detail: "Working through the details.",
    tone: "tool" as const,
  },
];

describe("ReasoningActivityStream", () => {
  it("preserves full provider reasoning entries in order", () => {
    expect(reasoningActivityText(entries)).toBe(
      "**Reading the request**\n\n<!-- -->\n\nWorking through the details.",
    );
  });

  it("renders the beUI-style working viewport without the synthetic Swap state", () => {
    const markup = renderToStaticMarkup(
      <ReasoningActivityStream
        entries={entries}
        fontSize={14}
        markdownCwd={undefined}
        onImageExpand={() => {}}
      />,
    );

    expect(markup).toContain('data-reasoning-activity-stream="true"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Thinking…");
    expect(markup).toContain("Reading the request");
    expect(markup).toContain("Working through the details.");
    expect(markup).not.toContain('data-reasoning-text-swap="true"');
  });
});
