import "../../index.css";

import {
  OrchestratorMessageId,
  ThreadId,
  type OrchestratorMessageEnvelope,
  type OrchestratorSnapshot,
} from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { Thread } from "~/types";

import { TeamPanel } from "./TeamPanel";

const ROOT = ThreadId.makeUnsafe("root-team-layout");
const ARCHITECTURE = ThreadId.makeUnsafe("child-architecture");
const REVIEWER = ThreadId.makeUnsafe("child-reviewer");
const RESEARCH = ThreadId.makeUnsafe("child-research");

const labels = new Map([
  [ROOT, "Create UI Acceptance Root"],
  [ARCHITECTURE, "Architecture"],
  [REVIEWER, "Reviewer"],
  [RESEARCH, "Research"],
]);

function thread(id: ThreadId, title: string): Thread {
  return {
    id,
    title,
    modelSelection: {
      provider: "codex",
      model: "gpt-5.6-luna",
      reasoningEffort: "high",
    },
    session: {
      provider: "codex",
      status: "ready",
      orchestrationStatus: "idle",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
  } as Thread;
}

const threads = [
  thread(ROOT, "Create UI Acceptance Root"),
  thread(ARCHITECTURE, "Architecture"),
  thread(REVIEWER, "Reviewer"),
  thread(RESEARCH, "Research"),
];

const snapshot = {
  root: { rootThreadId: ROOT },
  ownershipEdges: [ARCHITECTURE, REVIEWER, RESEARCH].map((childThreadId) => ({
    parentThreadId: ROOT,
    childThreadId,
    activeFrom: "2026-08-02T00:00:00.000Z",
    retiredAt: null,
  })),
  communicationLinks: [
    {
      id: "architecture-reviewer",
      sourceThreadId: ARCHITECTURE,
      targetThreadId: REVIEWER,
      direction: "bidirectional",
      state: "granted",
      taskId: null,
      runId: null,
      reason: "Design challenge",
      expiresAt: null,
    },
  ],
  assignments: [],
  childProjections: [ARCHITECTURE, REVIEWER, RESEARCH].map((threadId) => ({
    threadId,
    orchestrationState: "available",
  })),
} as unknown as OrchestratorSnapshot;

const exchanges = Array.from({ length: 24 }, (_, index) => {
  const senderThreadId = index % 2 === 0 ? ARCHITECTURE : REVIEWER;
  const targetThreadId = index % 2 === 0 ? REVIEWER : ARCHITECTURE;
  const timestamp = new Date(Date.UTC(2026, 7, 2, 0, index)).toISOString();
  return {
    messageId: OrchestratorMessageId.makeUnsafe(`team-message-${index}`),
    senderThreadId,
    targetThreadId,
    body: `Durable peer exchange ${index}`,
    deliveryState: "delivered",
    createdAt: timestamp,
    updatedAt: timestamp,
  } as OrchestratorMessageEnvelope;
});

async function renderTeamPanel(width: number) {
  const result = await render(
    <div style={{ width, height: 680 }}>
      <TeamPanel
        snapshot={snapshot}
        threads={threads}
        selectedThreadId={ROOT}
        threadLabels={labels}
        onSelectThread={vi.fn()}
        exchanges={exchanges}
        exchangesLoading={false}
        exchangesError={null}
      />
    </div>,
  );
  await result.baseElement.ownerDocument.fonts.ready;
  return result;
}

function section(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-team-section="${name}"]`);
  if (!element) throw new Error(`Missing Team section: ${name}`);
  return element;
}

describe("TeamPanel adaptive layout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps Recent Activity independently scrollable above pinned Connections [geometry:linux]", async () => {
    await renderTeamPanel(480);

    const ownership = section("ownership");
    const activity = section("activity");
    const connections = section("connections");
    const research = document.querySelector<HTMLElement>(`[data-team-thread-id="${RESEARCH}"]`);

    expect(research).not.toBeNull();
    expect(research!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      ownership.getBoundingClientRect().bottom + 1,
    );
    expect(ownership.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      activity.getBoundingClientRect().top + 1,
    );
    expect(activity.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      connections.getBoundingClientRect().top + 1,
    );
    expect(activity.scrollHeight).toBeGreaterThan(activity.clientHeight);
    expect(document.querySelector('[data-team-children]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("CHILD OWNER");
    expect(document.body.textContent).toContain("Codex · GPT-5.6 Luna");
    const explicitConnection = document.querySelector<HTMLElement>(
      '[data-communication-route="explicit-link"]',
    );
    expect(explicitConnection?.textContent).toContain("Architecture");
    expect(explicitConnection?.textContent).toContain("↔");
    expect(explicitConnection?.textContent).toContain("Reviewer");
  });

  it("keeps Team and Connections separate from the full-height Activity column [geometry:linux]", async () => {
    await renderTeamPanel(900);

    const ownership = section("ownership");
    const activity = section("activity");
    const connections = section("connections");
    const ownershipRect = ownership.getBoundingClientRect();
    const activityRect = activity.getBoundingClientRect();
    const connectionsRect = connections.getBoundingClientRect();

    expect(ownershipRect.right).toBeLessThanOrEqual(activityRect.left + 1);
    expect(connectionsRect.right).toBeLessThanOrEqual(activityRect.left + 1);
    expect(ownershipRect.bottom).toBeLessThanOrEqual(connectionsRect.top + 1);
    expect(activityRect.top).toBeLessThanOrEqual(ownershipRect.top + 1);
    expect(activityRect.bottom).toBeGreaterThanOrEqual(connectionsRect.bottom - 1);
    expect(activity.scrollHeight).toBeGreaterThan(activity.clientHeight);
  });
});
