// FILE: MessagesTimeline.toolGroupCollapse.browser.tsx
// Purpose: Browser regressions for collapsing settled tool-call runs into
//          semantic summary rows once a newer narration block starts.
// Layer: Vitest browser tests

import "../../index.css";

import { MessageId, TurnId } from "@synara/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MessagesTimeline } from "./MessagesTimeline";
import type { TimelineEntry } from "../../session-logic";

function assistantEntry(id: string, text: string, streaming: boolean): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: "2026-03-17T19:12:28.000Z",
    message: {
      id: MessageId.makeUnsafe(id),
      role: "assistant",
      text,
      createdAt: "2026-03-17T19:12:28.000Z",
      streaming,
      turnId: TurnId.makeUnsafe("turn-live"),
    },
  };
}

function userEntry(id: string, text: string): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "message",
    createdAt: "2026-03-17T19:12:28.000Z",
    message: {
      id: MessageId.makeUnsafe(id),
      role: "user",
      text,
      createdAt: "2026-03-17T19:12:28.000Z",
      streaming: false,
    },
  };
}

function commandEntry(id: string, command: string): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "work",
    createdAt: "2026-03-17T19:12:28.000Z",
    entry: {
      id,
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "Ran command",
      tone: "tool",
      itemType: "command_execution",
      toolStatus: "completed",
      command,
    },
  };
}

function thinkingEntry(id: string, label: string): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "work",
    createdAt: "2026-03-17T19:12:28.000Z",
    entry: {
      id,
      createdAt: "2026-03-17T19:12:28.000Z",
      label,
      tone: "thinking",
    },
  };
}

const SETTLED_COMMANDS = [
  "bun run lint",
  "bun run typecheck",
  "bun run build",
  "node scripts/check.mjs",
];
// Commands whose display text passes through verbatim (no humanized rewrite).
const LIVE_COMMANDS = ["git status", "node scripts/tail.mjs"];

function ToolGroupCollapseTimeline(props: {
  timelineEntries: TimelineEntry[];
  isWorking?: boolean;
  activeTurnInProgress?: boolean;
}) {
  return (
    <MessagesTimeline
      hasMessages
      isWorking={props.isWorking ?? false}
      activeTurnInProgress={props.activeTurnInProgress ?? true}
      activeTurnId={TurnId.makeUnsafe("turn-live")}
      activeTurnStartedAt="2026-03-17T19:12:20.000Z"
      timelineEntries={props.timelineEntries}
      turnDiffSummaryByAssistantMessageId={new Map()}
      nowIso="2026-03-17T19:12:30.000Z"
      expandedWorkGroups={{}}
      onToggleWorkGroup={() => {}}
      onOpenTurnDiff={() => {}}
      revertTurnCountByUserMessageId={new Map()}
      onRevertUserMessage={() => {}}
      isRevertingCheckpoint={false}
      onImageExpand={() => {}}
      markdownCwd={undefined}
      resolvedTheme="dark"
      timestampFormat="locale"
      workspaceRoot={undefined}
    />
  );
}

function createTimelineHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.style.cssText = "display:flex;width:600px;height:520px;overflow:hidden;";
  document.body.append(host);
  return host;
}

function findSummaryTrigger(label: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((button) =>
      (button.textContent ?? "").includes(label),
    ) ?? null
  );
}

function findSummaryTriggers(label: string): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].filter(
    (button) => (button.textContent ?? "").includes(label),
  );
}

function isVisibleOutsideClosedDisclosure(text: string): boolean {
  // The innermost element containing the text (command labels may span nested
  // spans, so a leaf-only check would miss them).
  const match = [...document.querySelectorAll<HTMLElement>("*")].findLast((element) =>
    (element.textContent ?? "").includes(text),
  );
  return match !== undefined && match.closest("[aria-hidden='true']") === null;
}

function isThinkingVisible(): boolean {
  return [...document.querySelectorAll<HTMLElement>("[data-turn-thinking='true']")].some(
    (element) => element.closest("[aria-hidden='true']") === null,
  );
}

describe("MessagesTimeline tool group collapse", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collapses the settled run behind a summary and keeps the live run expanded", async () => {
    const host = createTimelineHost();
    const screen = await render(
      <ToolGroupCollapseTimeline
        timelineEntries={[
          assistantEntry("narration-1", "Looking at the failing checks first.", false),
          ...SETTLED_COMMANDS.map((command, index) => commandEntry(`settled-${index}`, command)),
          assistantEntry("narration-2", "Now inspecting the working tree.", true),
          ...LIVE_COMMANDS.map((command, index) => commandEntry(`live-${index}`, command)),
        ]}
      />,
      { container: host },
    );

    try {
      await expect.poll(() => findSummaryTriggers("Ran commands").length).toBe(2);
      const trigger = findSummaryTriggers("Ran commands")[0]!;
      const liveTrigger = findSummaryTriggers("Ran commands")[1]!;
      expect(trigger.getAttribute("aria-expanded")).toBe("false");

      // Closed groups do not mount every tool row; this keeps large settled
      // transcripts cheap until the user asks to inspect the details.
      for (const command of SETTLED_COMMANDS) {
        expect(document.body.textContent ?? "").not.toContain(command);
      }

      // The live run keeps the semantic headline visible while its rows stream.
      expect(liveTrigger.getAttribute("aria-expanded")).toBe("true");
      for (const command of LIVE_COMMANDS) {
        expect(isVisibleOutsideClosedDisclosure(command)).toBe(true);
      }

      trigger.click();

      await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
      for (const command of SETTLED_COMMANDS) {
        await expect.poll(() => isVisibleOutsideClosedDisclosure(command)).toBe(true);
      }

      trigger.click();

      await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("false");
      // Rows remain mounted only long enough for the shared 220ms close motion.
      await expect
        .poll(() => (document.body.textContent ?? "").includes(SETTLED_COMMANDS[0]!))
        .toBe(false);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps generic thinking inside the active purpose instead of splitting the group", async () => {
    const host = createTimelineHost();
    // A provider thinking delta is not a semantic phase boundary. All tool
    // calls remain in one live purpose group and the generic row is suppressed.
    const screen = await render(
      <ToolGroupCollapseTimeline
        timelineEntries={[
          assistantEntry("narration-1", "Looking at the failing checks first.", true),
          ...SETTLED_COMMANDS.map((command, index) => commandEntry(`settled-${index}`, command)),
          thinkingEntry("think-1", "Weighing the next verification step"),
          ...LIVE_COMMANDS.map((command, index) => commandEntry(`live-${index}`, command)),
        ]}
      />,
      { container: host },
    );

    try {
      await expect.poll(() => findSummaryTriggers("Ran commands").length).toBe(1);
      expect(findSummaryTrigger("Ran commands")!.getAttribute("aria-expanded")).toBe("true");
      expect(document.body.textContent ?? "").not.toContain("Weighing the next verification step");
      const visibleToolRows = [
        ...document.querySelectorAll<HTMLElement>("[data-work-entry-row='true']"),
      ].filter((element) => element.closest("[aria-hidden='true']") === null);
      expect(visibleToolRows).toHaveLength(SETTLED_COMMANDS.length + LIVE_COMMANDS.length);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("keeps one work-region DOM identity while Working settles to Worked", async () => {
    const host = createTimelineHost();
    const liveEntries = [
      assistantEntry("settling-intro", "Running the final verification.", false),
      commandEntry("settling-command", "bun run build"),
      assistantEntry("settling-assistant", "Finishing the verification.", true),
    ];
    const mounted = await render(
      <ToolGroupCollapseTimeline timelineEntries={liveEntries} isWorking activeTurnInProgress />,
      { container: host },
    );

    try {
      await expect.poll(() => document.body.textContent ?? "").toContain("Working for");
      expect(document.body.textContent ?? "").not.toContain("Used a tool");
      expect(isThinkingVisible()).toBe(false);
      const liveRegion = document.querySelector<HTMLElement>("[data-turn-work-region]");
      expect(liveRegion).not.toBeNull();

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[
            assistantEntry("settling-intro", "Running the final verification.", false),
            commandEntry("settling-command", "bun run build"),
            assistantEntry("settling-assistant", "Finishing the verification.", false),
          ]}
          isWorking={false}
          activeTurnInProgress={false}
        />,
      );

      await expect.poll(() => document.body.textContent ?? "").toContain("Worked for");
      expect(document.querySelector<HTMLElement>("[data-turn-work-region]")).toBe(liveRegion);
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });

  it("keeps the settled region mounted while an optimistic follow-up starts", async () => {
    const host = createTimelineHost();
    host.style.height = "1200px";
    const settledEntries = [
      userEntry("settled-user", "Run the verification."),
      commandEntry("settled-command", "bun run build"),
      assistantEntry("settled-assistant", "The verification passed.", false),
    ];
    const mounted = await render(
      <ToolGroupCollapseTimeline
        timelineEntries={settledEntries}
        isWorking={false}
        activeTurnInProgress={false}
      />,
      { container: host },
    );

    try {
      const settledRegion = Array.from(
        document.querySelectorAll<HTMLElement>("[data-turn-work-region]"),
      ).find((row) =>
        row.querySelector('[aria-hidden="false"]')?.textContent?.includes("Worked for"),
      );
      expect(settledRegion).not.toBeUndefined();

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[
            ...settledEntries,
            userEntry("optimistic-user", "Start the follow-up."),
          ]}
          isWorking
          activeTurnInProgress
        />,
      );

      await expect
        .poll(() =>
          Array.from(document.querySelectorAll<HTMLElement>("[data-turn-work-region]")).some(
            (row) =>
              row !== settledRegion &&
              row.querySelector('[aria-hidden="false"]')?.textContent?.startsWith("Working") ===
                true,
          ),
        )
        .toBe(true);
      expect(document.body.contains(settledRegion ?? null)).toBe(true);
      expect(settledRegion?.querySelector('[aria-hidden="false"]')?.textContent).toContain(
        "Worked for",
      );
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });

  it("keeps Worked visible after a no-tool turn settles", async () => {
    const host = createTimelineHost();
    const mounted = await render(
      <ToolGroupCollapseTimeline
        timelineEntries={[assistantEntry("plain-assistant", "Hello from a plain turn.", true)]}
        isWorking
        activeTurnInProgress
      />,
      { container: host },
    );

    try {
      const liveRegion = document.querySelector<HTMLElement>("[data-turn-work-region]");
      expect(liveRegion).not.toBeNull();
      expect(isThinkingVisible()).toBe(true);

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[assistantEntry("plain-assistant", "Hello from a plain turn.", false)]}
          isWorking={false}
          activeTurnInProgress={false}
        />,
      );

      const settledRegion = document.querySelector<HTMLElement>("[data-turn-work-region]");
      expect(settledRegion).toBe(liveRegion);
      expect(settledRegion?.querySelector("[aria-hidden='false']")?.textContent).toContain(
        "Worked for",
      );
      expect(settledRegion?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
      expect(isThinkingVisible()).toBe(false);
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });
});
