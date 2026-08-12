// FILE: MessagesTimeline.toolGroupCollapse.browser.tsx
// Purpose: Browser regressions for collapsing settled tool-call runs into
//          semantic summary rows once a newer narration block starts.
// Layer: Vitest browser tests

import "../../index.css";

import { MessageId, TurnId } from "@veylen/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { MessagesTimeline } from "./MessagesTimeline";
import { resetMessagesTimelineStickySettleForTests } from "./MessagesTimeline.logic";
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
      turnId: TurnId.makeUnsafe("turn-live"),
    },
  };
}

function reasoningEntry(id: string, preview: string): TimelineEntry {
  return {
    id: `entry-${id}`,
    kind: "work",
    createdAt: "2026-03-17T19:12:28.000Z",
    entry: {
      id,
      createdAt: "2026-03-17T19:12:28.000Z",
      label: "Reasoning summary",
      toolTitle: "Reasoning summary",
      preview,
      tone: "tool",
      turnId: TurnId.makeUnsafe("turn-live"),
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
  activeTurnStartedAt?: string;
  followLiveOutput?: boolean;
}) {
  return (
    <MessagesTimeline
      hasMessages
      isWorking={props.isWorking ?? false}
      activeTurnInProgress={props.activeTurnInProgress ?? true}
      activeTurnId={TurnId.makeUnsafe("turn-live")}
      activeTurnStartedAt={props.activeTurnStartedAt ?? "2026-03-17T19:12:20.000Z"}
      {...(props.followLiveOutput !== undefined
        ? { followLiveOutput: props.followLiveOutput }
        : {})}
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
  beforeEach(() => {
    resetMessagesTimelineStickySettleForTests();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps settled and streaming tool runs collapsed until explicitly opened", async () => {
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
      const nextAssistantText = document.querySelector<HTMLElement>(
        '[data-assistant-message-id="narration-2"]',
      )!;
      expect(
        trigger.compareDocumentPosition(nextAssistantText) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(
        nextAssistantText.compareDocumentPosition(liveTrigger) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).not.toBe(0);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");

      // Closed groups do not mount every tool row; this keeps large settled
      // transcripts cheap until the user asks to inspect the details.
      for (const command of SETTLED_COMMANDS) {
        expect(document.body.textContent ?? "").not.toContain(command);
      }

      // Streaming updates only the semantic headline; verbose command rows stay hidden.
      expect(liveTrigger.getAttribute("aria-expanded")).toBe("false");
      for (const command of LIVE_COMMANDS) {
        expect(isVisibleOutsideClosedDisclosure(command)).toBe(false);
      }

      trigger.click();

      await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
      await expect
        .poll(
          () =>
            [...document.querySelectorAll<HTMLElement>("[data-work-entry-row='true']")].filter(
              (element) => element.closest("[aria-hidden='true']") === null,
            ).length,
        )
        .toBe(SETTLED_COMMANDS.length);
      expect(document.body.textContent ?? "").not.toContain("Completed command");

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

  it("keeps reasoning out of expanded tool details", async () => {
    const host = createTimelineHost();
    const screen = await render(
      <ToolGroupCollapseTimeline
        timelineEntries={[
          assistantEntry("narration-1", "Looking at the failing checks first.", true),
          ...SETTLED_COMMANDS.map((command, index) => commandEntry(`settled-${index}`, command)),
          reasoningEntry("think-1", "Weighing the next verification step"),
          ...LIVE_COMMANDS.map((command, index) => commandEntry(`live-${index}`, command)),
        ]}
      />,
      { container: host },
    );

    try {
      await expect.poll(() => findSummaryTriggers("Ran commands").length).toBe(1);
      const trigger = findSummaryTrigger("Ran commands")!;
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(document.body.textContent ?? "").not.toContain("Weighing the next verification step");
      const visibleToolRows = [
        ...document.querySelectorAll<HTMLElement>("[data-work-entry-row='true']"),
      ].filter((element) => element.closest("[aria-hidden='true']") === null);
      expect(visibleToolRows).toHaveLength(0);

      trigger.click();
      await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
      expect(trigger.nextElementSibling?.textContent ?? "").not.toContain(
        "Weighing the next verification step",
      );
      expect(
        [...document.querySelectorAll<HTMLElement>("[data-work-entry-row='true']")].filter(
          (element) => element.closest("[aria-hidden='true']") === null,
        ),
      ).toHaveLength(SETTLED_COMMANDS.length + LIVE_COMMANDS.length);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });

  it("swaps tool and reasoning headlines in one stable disclosure row", async () => {
    const host = createTimelineHost();
    const user = userEntry("reasoning-user", "Inspect the workspace.");
    const firstReasoning = reasoningEntry("reasoning-first", "Inspecting the workspace");
    const tool = commandEntry("reasoning-command", "bun run build");
    const secondReasoning = reasoningEntry("reasoning-second", "Checking the build result");
    const nextTool = commandEntry("reasoning-command-next", "bun run test");
    const mounted = await render(
      <ToolGroupCollapseTimeline timelineEntries={[user]} isWorking activeTurnInProgress />,
      { container: host },
    );

    try {
      expect(isThinkingVisible()).toBe(true);

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[user, firstReasoning]}
          isWorking
          activeTurnInProgress
        />,
      );
      await expect
        .poll(() => document.body.textContent ?? "")
        .toContain("Inspecting the workspace");
      expect(document.querySelector("[data-timeline-row-kind='reasoning-status']")).toBeNull();
      expect(
        document
          .querySelector("[data-turn-work-region]")
          ?.querySelector("[data-work-status-text='working']")
          ?.getAttribute("aria-hidden"),
      ).toBe("false");

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[user, firstReasoning, tool]}
          isWorking
          activeTurnInProgress
        />,
      );
      const toolTrigger = findSummaryTrigger("Ran a command");
      expect(toolTrigger).not.toBeNull();
      expect(toolTrigger?.getAttribute("aria-expanded")).toBe("false");
      expect(document.body.textContent ?? "").not.toContain("Inspecting the workspace");
      expect(isThinkingVisible()).toBe(false);

      toolTrigger?.click();
      await expect.poll(() => toolTrigger?.getAttribute("aria-expanded")).toBe("true");
      expect(document.body.textContent ?? "").toContain("Ran command");
      expect(toolTrigger?.nextElementSibling?.textContent ?? "").not.toContain(
        "Inspecting the workspace",
      );
      expect(document.body.textContent ?? "").not.toContain("bun run build");
      expect(document.body.textContent ?? "").not.toContain("Completed command");
      toolTrigger?.click();
      await expect.poll(() => toolTrigger?.getAttribute("aria-expanded")).toBe("false");

      const summarySwap = document.querySelector<HTMLElement>("[data-tool-summary-swap='true']");
      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[user, firstReasoning, tool, secondReasoning]}
          isWorking
          activeTurnInProgress
        />,
      );
      await expect
        .poll(() => document.body.textContent ?? "")
        .toContain("Checking the build result");
      expect(document.querySelector("[data-timeline-row-kind='reasoning-status']")).toBeNull();
      expect(document.querySelector("[data-tool-summary-swap='true']")).toBe(summarySwap);

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[user, firstReasoning, tool, secondReasoning, nextTool]}
          isWorking
          activeTurnInProgress
        />,
      );
      await expect.poll(() => findSummaryTrigger("Ran commands")).not.toBeNull();
      expect(document.querySelector("[data-tool-summary-swap='true']")).toBe(summarySwap);
      expect(document.querySelector("[data-timeline-row-kind='reasoning-status']")).toBeNull();
      expect(document.body.textContent ?? "").toContain("Checking the build result");
    } finally {
      await mounted.unmount();
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
          isWorking
          activeTurnInProgress={false}
        />,
      );

      await expect.poll(() => document.body.textContent ?? "").toContain("Worked for");
      expect(document.querySelectorAll("[data-turn-work-region]")).toHaveLength(1);
      expect(document.querySelector<HTMLElement>("[data-turn-work-region]")).toBe(liveRegion);
      expect(liveRegion?.querySelector("[data-work-status-text='working']")?.className).toContain(
        "work-status-swap__phrase--exit",
      );
      expect(liveRegion?.querySelector("[data-work-status-text='settled']")?.className).toContain(
        "work-status-swap__phrase--visible",
      );
      expect(liveRegion?.querySelector("[data-work-status-text='settled']")?.textContent).toContain(
        "Worked for 2s",
      );
      expect(liveRegion?.querySelector("[data-work-status-text='working']")?.textContent).toContain(
        "Working for 2s",
      );

      const workingLayer = liveRegion?.querySelector<HTMLElement>(
        "[data-work-status-text='working']",
      );
      const settledLayer = liveRegion?.querySelector<HTMLElement>(
        "[data-work-status-text='settled']",
      );
      // Opacity + translateY only — blur was removed because near-identical
      // Working/Worked copy read as a smudge under filter.
      expect(getComputedStyle(workingLayer!).transitionDuration.split(", ")).toEqual([
        "0.16s",
        "0.16s",
      ]);
      expect(getComputedStyle(workingLayer!).transitionProperty).toContain("transform");
      expect(getComputedStyle(workingLayer!).transitionProperty).toContain("opacity");
      expect(getComputedStyle(workingLayer!).transitionProperty).not.toContain("filter");
      expect(getComputedStyle(workingLayer!).transform).not.toBe("none");
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const transitioningOpacity = Number.parseFloat(getComputedStyle(settledLayer!).opacity);
      expect(transitioningOpacity).toBeGreaterThan(0);
      expect(transitioningOpacity).toBeLessThan(1);
      await expect.poll(() => getComputedStyle(settledLayer!).opacity).toBe("1");

      // Process details open on the settle frame then close with shared disclosure motion.
      // Steady state: closed disclosure (user can re-open via the chevron).
      await expect
        .poll(
          () =>
            liveRegion
              ?.querySelector("[data-turn-work-details]")
              ?.getAttribute("data-turn-work-details") === "closed",
        )
        .toBe(true);
      await expect
        .poll(() => liveRegion?.querySelector("button")?.getAttribute("aria-expanded"))
        .toBe("false");

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
      expect(document.querySelector<HTMLElement>("[data-turn-work-region]")).toBe(liveRegion);
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });

  it("settles repeated turns without measurement feedback loops", async () => {
    const host = createTimelineHost();
    host.style.height = "190px";
    let timelineEntries: TimelineEntry[] = [];
    let mounted: Awaited<ReturnType<typeof render>> | null = null;

    const waitForFrames = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    };
    const footerHeight = (assistantRow: HTMLElement) => {
      const footer = assistantRow.querySelector<HTMLElement>("[data-assistant-message-footer]");
      return footer?.getBoundingClientRect().height ?? 0;
    };

    try {
      for (let turn = 1; turn <= 3; turn += 1) {
        const userId = `motion-user-${turn}`;
        const assistantId = `motion-assistant-${turn}`;
        timelineEntries = [
          ...timelineEntries,
          userEntry(userId, `Prompt ${turn}`),
          commandEntry(`motion-command-${turn}`, `echo ${turn}`),
          // Provider text has already completed here; only the turn lifecycle
          // changes on the Working -> Worked settlement frame.
          assistantEntry(assistantId, `Answer ${turn}`, false),
        ];
        const liveTimeline = (
          <ToolGroupCollapseTimeline
            timelineEntries={timelineEntries}
            isWorking
            activeTurnInProgress
            followLiveOutput
          />
        );
        if (mounted) {
          await mounted.rerender(liveTimeline);
        } else {
          mounted = await render(liveTimeline, { container: host });
        }

        const activityId = `turn-activity:${userId}`;
        await expect
          .poll(() =>
            host
              .querySelector<HTMLElement>(`[data-turn-work-region='${activityId}']`)
              ?.querySelector<HTMLElement>("[data-work-status-text='working']")
              ?.getAttribute("aria-hidden"),
          )
          .toBe("false");
        await waitForFrames(8);

        const liveRegion = host.querySelector<HTMLElement>(
          `[data-turn-work-region='${activityId}']`,
        )!;
        const liveActivityRow = liveRegion.closest<HTMLElement>(
          "[data-timeline-row-kind='turn-activity']",
        )!;
        const liveAssistantRow = host.querySelector<HTMLElement>(
          `[data-message-id='${assistantId}']`,
        )!;
        const scrollContainer = host.querySelector<HTMLElement>(
          "[data-chat-scroll-container='true']",
        )!;
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        scrollContainer.dispatchEvent(new Event("scroll"));
        await waitForFrames(3);

        const before = {
          activityHeight: liveActivityRow.getBoundingClientRect().height,
          activityRegionHeight: liveRegion.getBoundingClientRect().height,
          activityRegionMarginBottom: getComputedStyle(liveRegion).marginBottom,
          activityButtonHeight: liveRegion.querySelector("button")?.getBoundingClientRect().height,
          activityDetailsHeight: liveRegion
            .querySelector("[data-turn-work-details]")
            ?.getBoundingClientRect().height,
          assistantHeight: liveAssistantRow.getBoundingClientRect().height,
          footerHeight: footerHeight(liveAssistantRow),
          scrollHeight: scrollContainer.scrollHeight,
        };
        timelineEntries = timelineEntries.map((entry) =>
          entry.kind === "message" && entry.message.id === assistantId
            ? assistantEntry(assistantId, `Answer ${turn}`, false)
            : entry,
        );
        await mounted.rerender(
          <ToolGroupCollapseTimeline
            timelineEntries={timelineEntries}
            isWorking={false}
            activeTurnInProgress={false}
            followLiveOutput
          />,
        );

        const frames: Array<{
          activityY: number;
          settledOpacity: number;
          scrollTop: number;
        }> = [];
        for (let frame = 0; frame < 36; frame += 1) {
          await waitForFrames(1);
          frames.push({
            activityY: liveRegion.getBoundingClientRect().y,
            settledOpacity: Number.parseFloat(
              getComputedStyle(
                liveRegion.querySelector<HTMLElement>("[data-work-status-text='settled']")!,
              ).opacity,
            ),
            scrollTop: scrollContainer.scrollTop,
          });
        }

        const settledRegion = host.querySelector<HTMLElement>(
          `[data-turn-work-region='${activityId}']`,
        )!;
        const settledActivityRow = settledRegion.closest<HTMLElement>(
          "[data-timeline-row-kind='turn-activity']",
        )!;
        const settledAssistantRow = host.querySelector<HTMLElement>(
          `[data-message-id='${assistantId}']`,
        )!;
        const after = {
          activityHeight: settledActivityRow.getBoundingClientRect().height,
          activityRegionHeight: settledRegion.getBoundingClientRect().height,
          activityRegionMarginBottom: getComputedStyle(settledRegion).marginBottom,
          activityButtonHeight: settledRegion.querySelector("button")?.getBoundingClientRect()
            .height,
          activityDetailsHeight: settledRegion
            .querySelector("[data-turn-work-details]")
            ?.getBoundingClientRect().height,
          assistantHeight: settledAssistantRow.getBoundingClientRect().height,
          footerHeight: footerHeight(settledAssistantRow),
          scrollHeight: scrollContainer.scrollHeight,
        };
        const maximumFrameJump = frames.slice(1).reduce((maximum, frame, index) => {
          const previous = frames[index]!;
          return Math.max(
            maximum,
            Math.abs(frame.activityY - previous.activityY),
            Math.abs(frame.scrollTop - previous.scrollTop),
          );
        }, 0);
        const frameDirections = frames
          .slice(1)
          .map((frame, index) => Math.sign(frame.activityY - frames[index]!.activityY))
          .filter((direction) => direction !== 0);
        const directionReversals = frameDirections
          .slice(1)
          .filter((direction, index) => direction !== frameDirections[index]).length;

        expect(settledRegion).toBe(liveRegion);
        expect(settledActivityRow).toBe(liveActivityRow);
        expect(
          Math.abs(after.activityHeight - before.activityHeight),
          `activity geometry changed across settle: ${JSON.stringify({ before, after })}`,
        ).toBeLessThan(0.75);
        expect(Math.abs(after.footerHeight - before.footerHeight)).toBeLessThan(0.75);
        // The completed tool row folds into the closed disclosure immediately,
        // so one bounded anchor correction is expected. It must not oscillate:
        // alternating corrections indicate a measure/scroll feedback loop.
        expect(
          maximumFrameJump,
          `settle frame jump: ${JSON.stringify({ before, after, frames })}`,
        ).toBeLessThan(50);
        expect(
          directionReversals,
          `settle frame oscillation: ${JSON.stringify({ frameDirections, frames })}`,
        ).toBeLessThanOrEqual(1);
        expect(frames.some((frame) => frame.settledOpacity > 0 && frame.settledOpacity < 1)).toBe(
          true,
        );
        expect(frames.at(-1)?.settledOpacity).toBe(1);
      }
    } finally {
      await mounted?.unmount();
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

      await expect.poll(() => document.querySelector("[data-turn-thinking='true']")).not.toBeNull();
      expect(document.body.contains(settledRegion ?? null)).toBe(true);
      expect(settledRegion?.querySelector('[aria-hidden="false"]')?.textContent).toContain(
        "Worked for",
      );
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });

  it("keeps pure-text turns headerless until late tool details hydrate settled work", async () => {
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
      expect(liveRegion).toBeNull();
      expect(isThinkingVisible()).toBe(false);

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[assistantEntry("plain-assistant", "Hello from a plain turn.", false)]}
          isWorking={false}
          activeTurnInProgress={false}
        />,
      );

      const settledRegion = document.querySelector<HTMLElement>("[data-turn-work-region]");
      expect(settledRegion).toBeNull();
      expect(isThinkingVisible()).toBe(false);

      await mounted.rerender(
        <ToolGroupCollapseTimeline
          timelineEntries={[
            commandEntry("late-command", "bun run build"),
            assistantEntry("plain-assistant", "Hello from a plain turn.", false),
          ]}
          isWorking={false}
          activeTurnInProgress={false}
        />,
      );

      const hydratedRegion = document.querySelector<HTMLElement>("[data-turn-work-region]");
      expect(hydratedRegion).not.toBeNull();
      expect(hydratedRegion?.getAttribute("data-settled-turn-collapse-transition")).toBeNull();
      expect(hydratedRegion?.querySelector("[aria-hidden='false']")?.textContent).toContain(
        "Worked for",
      );
      expect(hydratedRegion?.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
      expect(isThinkingVisible()).toBe(false);
    } finally {
      await mounted.unmount();
      host.remove();
    }
  });
});
