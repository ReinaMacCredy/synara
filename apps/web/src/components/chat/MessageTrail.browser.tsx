import "../../index.css";

import { MessageId } from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { MessageTrail } from "./MessageTrail";
import { createActiveTrailStore, type MessageTrailItem } from "./messageTrail.logic";

const ITEMS: readonly MessageTrailItem[] = [
  {
    id: MessageId.makeUnsafe("message-1"),
    ordinal: 1,
    preview: "First question about the project",
    responsePreview: "First answer",
    attachmentCount: 0,
  },
  {
    id: MessageId.makeUnsafe("message-2"),
    ordinal: 2,
    preview: "Second prompt with the next step",
    responsePreview: "Second answer",
    attachmentCount: 0,
  },
  {
    id: MessageId.makeUnsafe("message-3"),
    ordinal: 3,
    preview: "Third request for final verification",
    responsePreview: "Third answer",
    attachmentCount: 0,
  },
];

function createHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = "position:relative;display:flex;width:1000px;height:640px;overflow:hidden;";
  document.body.append(host);
  return host;
}

async function settleLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

describe("MessageTrail", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the whole prompt list, follows the pointer, and stays open while jumping", async () => {
    const host = createHost();
    const activeStore = createActiveTrailStore();
    activeStore.set({ currentId: ITEMS[1]!.id, visibleIds: [ITEMS[1]!.id] });
    const onSelect = vi.fn();
    const mounted = await render(
      <MessageTrail items={ITEMS} activeStore={activeStore} onSelect={onSelect} />,
      { container: host },
    );

    try {
      await vi.waitFor(() => {
        expect(
          mounted.container
            .querySelector('nav[aria-label="Conversation navigation"]')
            ?.getAttribute("aria-hidden"),
        ).toBe("false");
      });

      const navigator = mounted.container.querySelector<HTMLElement>(
        'nav[aria-label="Conversation navigation"]',
      );
      if (navigator) {
        navigator.style.display = "flex";
      }

      const trigger = mounted.container.querySelector<HTMLElement>(
        '[role="button"][aria-label="Open conversation navigator"]',
      );
      await page.getByRole("button", { name: "Open conversation navigator" }).hover();

        await vi.waitFor(() => {
          expect(trigger?.getAttribute("aria-expanded")).toBe("true");
          expect(mounted.container.querySelectorAll('[role="option"]')).toHaveLength(3);
        expect(mounted.container.querySelector('input[aria-label="Search messages"]')).toBeNull();
        expect(
          mounted.container.querySelector('[role="option"][aria-current="location"]')?.textContent,
          ).toContain("Second prompt");
        });

        const firstTick = mounted.container.querySelector<HTMLElement>('span[aria-hidden="true"]');
        const firstOption = mounted.container.querySelector<HTMLElement>('[role="option"]');
        expect(getComputedStyle(firstTick!).transitionProperty).toContain("transform");
        expect(getComputedStyle(firstTick!).transitionProperty).not.toContain("width");
        expect(getComputedStyle(firstOption!).transitionDuration).toBe("0s");

      const triggerRect = trigger?.getBoundingClientRect();
      trigger?.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          pointerType: "mouse",
          clientY: (triggerRect?.top ?? 0) + 1,
        }),
      );
        await vi.waitFor(() => {
          expect(
            mounted.container.querySelector('[role="option"][data-active="true"]')?.textContent,
          ).toContain("First question");
          expect(firstTick?.style.transform).toContain("scaleX(");
          expect(firstTick?.style.width).toBe("6px");
        });

      await page.getByText("Third request for final verification", { exact: true }).hover();
      await vi.waitFor(() => {
        expect(
          mounted.container.querySelector('[role="option"][data-active="true"]')?.textContent,
        ).toContain("Third request");
      });

      mounted.container.querySelector<HTMLButtonElement>('[role="option"]')?.click();
      expect(onSelect).toHaveBeenLastCalledWith(ITEMS[0]!.id);
      expect(
        mounted.container
          .querySelector('[role="button"][aria-label="Open conversation navigator"]')
        ?.getAttribute("aria-expanded"),
      ).toBe("true");
    } finally {
      await mounted.unmount();
      host.remove();
      await settleLayout();
    }
  });

  it("focuses one list target and supports arrow-key jumping from the shortcut", async () => {
    const host = createHost();
    const activeStore = createActiveTrailStore();
    activeStore.set({ currentId: ITEMS[0]!.id, visibleIds: [] });
    const onSelect = vi.fn();
    const mounted = await render(
      <MessageTrail items={ITEMS} activeStore={activeStore} onSelect={onSelect} focusRequest={0} />,
      { container: host },
    );
    const keyboardOutsideTarget = document.createElement("button");
    keyboardOutsideTarget.textContent = "Keyboard test outside";
    document.body.append(keyboardOutsideTarget);

    try {
      const navigator = mounted.container.querySelector<HTMLElement>(
        'nav[aria-label="Conversation navigation"]',
      );
      if (navigator) {
        navigator.style.display = "flex";
      }
      await page.getByRole("button", { name: "Keyboard test outside" }).hover();
      await mounted.rerender(
        <MessageTrail
          items={ITEMS}
          activeStore={activeStore}
          onSelect={onSelect}
          focusRequest={1}
        />,
      );

      await vi.waitFor(() => {
        expect(
          mounted.container
            .querySelector('nav[aria-label="Conversation navigation"]')
            ?.getAttribute("aria-hidden"),
        ).toBe("false");
      });

      await vi.waitFor(() => {
        expect(document.activeElement).toBe(
          mounted.container.querySelector('[role="listbox"][aria-label="Conversation messages"]'),
        );
      });
      const tabbableTargets = Array.from(
        mounted.container.querySelectorAll<HTMLElement>(
          'nav[aria-label="Conversation navigation"] [tabindex="0"]',
        ),
      );
      expect(tabbableTargets).toHaveLength(1);
      expect(tabbableTargets[0]).toBe(document.activeElement);

      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(onSelect).toHaveBeenLastCalledWith(ITEMS[1]!.id);
    } finally {
      await mounted.unmount();
      keyboardOutsideTarget.remove();
      host.remove();
      await settleLayout();
    }
  });

  it("keeps a safe hover grace period, then closes after the pointer leaves", async () => {
    const host = createHost();
    const activeStore = createActiveTrailStore();
    activeStore.set({ currentId: ITEMS[0]!.id, visibleIds: [] });
    const mounted = await render(
      <MessageTrail items={ITEMS} activeStore={activeStore} onSelect={() => {}} />,
      { container: host },
    );
    const outsideTarget = document.createElement("button");
    outsideTarget.textContent = "Outside navigator";
    document.body.append(outsideTarget);

    try {
      await vi.waitFor(() => {
        expect(
          mounted.container
            .querySelector('nav[aria-label="Conversation navigation"]')
            ?.getAttribute("aria-hidden"),
        ).toBe("false");
      });
      const navigator = mounted.container.querySelector<HTMLElement>(
        'nav[aria-label="Conversation navigation"]',
      );
      if (navigator) {
        navigator.style.display = "flex";
      }
      const trigger = mounted.container.querySelector<HTMLElement>(
        '[role="button"][aria-label="Open conversation navigator"]',
      );

      await page.getByRole("button", { name: "Open conversation navigator" }).hover();
      await page.getByRole("button", { name: "Open conversation navigator" }).click();
      await vi.waitFor(() => expect(trigger?.getAttribute("aria-expanded")).toBe("true"));

      await page.getByRole("button", { name: "Outside navigator" }).hover();
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      await page.getByRole("button", { name: "Open conversation navigator" }).hover();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");

      await page.getByRole("button", { name: "Outside navigator" }).hover();
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      await vi.waitFor(() => expect(trigger?.getAttribute("aria-expanded")).toBe("false"));
    } finally {
      await mounted.unmount();
      outsideTarget.remove();
      host.remove();
      await settleLayout();
    }
  });
});
