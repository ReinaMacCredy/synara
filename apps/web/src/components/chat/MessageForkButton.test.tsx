// FILE: MessageForkButton.test.tsx
// Purpose: Covers footer fork menu trigger chrome.
// Layer: Web chat component tests

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MessageForkButton } from "./MessageForkButton";

describe("MessageForkButton", () => {
  it("renders the menu trigger for forking the chat", () => {
    const markup = renderToStaticMarkup(
      <MessageForkButton
        localDescription="Continue in the current local thread"
        onFork={() => {}}
      />,
    );

    expect(markup).toContain('aria-label="Fork chat"');
    expect(markup).toContain("data-message-fork-button");
    expect(markup).toContain('aria-haspopup="menu"');
  });

  it("disables the trigger when disabled", () => {
    const onFork = vi.fn();
    const markup = renderToStaticMarkup(
      <MessageForkButton
        disabled
        localDescription="Continue in the current local thread"
        onFork={onFork}
      />,
    );

    expect(markup).toMatch(/disabled(?:="")?/);
    expect(onFork).not.toHaveBeenCalled();
  });
});
