import { useState } from "react";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ComposerPromptEditor } from "./ComposerPromptEditor";

function LaggingCursorHarness() {
  const [value, setValue] = useState("");

  return (
    <ComposerPromptEditor
      value={value}
      cursor={0}
      terminalContexts={[]}
      disabled={false}
      placeholder="Write a message"
      onRemoveTerminalContext={() => {}}
      onChange={(nextValue) => {
        setValue(nextValue);
      }}
      onPaste={() => {}}
    />
  );
}

function LaggingValueHarness() {
  const [value, setValue] = useState("");

  return (
    <ComposerPromptEditor
      value={value}
      cursor={value.length}
      terminalContexts={[]}
      disabled={false}
      placeholder="Write a message"
      onRemoveTerminalContext={() => {}}
      onChange={(nextValue) => {
        setValue(nextValue.slice(0, -1));
      }}
      onPaste={() => {}}
    />
  );
}

describe("ComposerPromptEditor controlled selection", () => {
  it("does not apply a lagging cursor prop over a focused editor change", async () => {
    await render(<LaggingCursorHarness />);

    const editor = page.getByTestId("composer-editor");
    await editor.click();
    await editor.fill("abc");

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="composer-editor"]')?.textContent).toBe("abc");
    });
    expect(window.getSelection()?.anchorOffset).toBe(3);
  });

  it("does not overwrite an unacknowledged focused editor value with a lagging prop", async () => {
    await render(<LaggingValueHarness />);

    const editor = page.getByTestId("composer-editor");
    await editor.click();
    await editor.fill("abc");

    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="composer-editor"]')?.textContent).toBe("abc");
    });
  });
});
