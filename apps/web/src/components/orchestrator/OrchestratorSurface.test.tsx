import {
  OrchestratorMessageId,
  ThreadId,
  type OrchestratorMessageEnvelope,
  type OrchestratorOwnershipEdge,
} from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  OrchestratorThreadMessageRow,
  OrchestratorTranscriptProvider,
} from "./OrchestratorThreadMessageRow";
import {
  buildOwnershipTree,
  communicationLinksForSelection,
  groupOrchestratorExchanges,
  resolveSelectedOrchestratorThreadId,
} from "./orchestratorViewModel";
import { CommunicationGraphInspect } from "./CommunicationGraphInspect";
import { CouncilRunView } from "./CouncilRunView";
import { ExchangesPanel } from "./ExchangesPanel";
import { FinalDecisionPacketView } from "./FinalDecisionPacketView";
import { RunsPanel } from "./RunsPanel";
import { TeamPanel } from "./TeamPanel";

const ROOT = ThreadId.makeUnsafe("root-a");
const CHILD_B = ThreadId.makeUnsafe("child-b");
const CHILD_C = ThreadId.makeUnsafe("child-c");
const CHILD_D = ThreadId.makeUnsafe("child-d");

function edge(parentThreadId: typeof ROOT, childThreadId: typeof ROOT): OrchestratorOwnershipEdge {
  return {
    parentThreadId,
    childThreadId,
    activeFrom: "2026-08-01T00:00:00.000Z",
    retiredAt: null,
  } as OrchestratorOwnershipEdge;
}

function exchange(input: {
  id: string;
  assignmentId?: string | null;
  runId?: string | null;
  correlationId?: string | null;
  createdAt: string;
}): OrchestratorMessageEnvelope {
  return {
    messageId: OrchestratorMessageId.makeUnsafe(input.id),
    senderThreadId: CHILD_B,
    targetThreadId: ROOT,
    assignmentId: input.assignmentId ?? null,
    runId: input.runId ?? null,
    correlationId: input.correlationId ?? null,
    body: `body ${input.id}`,
    deliveryState: "delivered",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  } as OrchestratorMessageEnvelope;
}

describe("Orchestrator surface view model", () => {
  const edges = [edge(ROOT, CHILD_B), edge(ROOT, CHILD_C), edge(CHILD_B, CHILD_D)];

  it("builds ownership as a tree without limiting the communication graph shape", () => {
    const tree = buildOwnershipTree(ROOT, edges);
    expect(tree.threadId).toBe(ROOT);
    expect(tree.children.map((node) => node.threadId)).toEqual([CHILD_B, CHILD_C]);
    expect(tree.children[0]?.children.map((node) => node.threadId)).toEqual([CHILD_D]);
  });

  it("keeps child selection inside the Root aggregate and rejects foreign deep links", () => {
    expect(resolveSelectedOrchestratorThreadId(ROOT, CHILD_D, edges)).toBe(CHILD_D);
    expect(resolveSelectedOrchestratorThreadId(ROOT, "foreign-thread", edges)).toBe(ROOT);
    expect(resolveSelectedOrchestratorThreadId(ROOT, undefined, edges)).toBe(ROOT);
  });

  it("groups exchanges by assignment before run and correlation", () => {
    const groups = groupOrchestratorExchanges([
      exchange({
        id: "m1",
        assignmentId: "assignment-1",
        runId: "run-1",
        createdAt: "2026-08-01T00:00:00.000Z",
      }),
      exchange({ id: "m2", assignmentId: "assignment-1", createdAt: "2026-08-01T00:00:01.000Z" }),
      exchange({ id: "m3", runId: "run-2", createdAt: "2026-08-01T00:00:02.000Z" }),
      exchange({ id: "m4", correlationId: "m3", createdAt: "2026-08-01T00:00:03.000Z" }),
    ]);
    expect(groups.map((group) => group.id)).toEqual([
      "correlation:m3",
      "run:run-2",
      "assignment:assignment-1",
    ]);
    expect(groups.at(-1)?.items.map((item) => item.messageId)).toEqual(["m1", "m2"]);
  });

  it("shows the whole Root communication graph and scopes child inspection", () => {
    const links = [
      { id: "bc", sourceThreadId: CHILD_B, targetThreadId: CHILD_C },
      { id: "cd", sourceThreadId: CHILD_C, targetThreadId: CHILD_D },
    ] as never;
    expect(communicationLinksForSelection(ROOT, ROOT, links)).toHaveLength(2);
    expect(communicationLinksForSelection(ROOT, CHILD_B, links)).toEqual([links[0]]);
  });

    it("exports every aggregate dock surface as a real component", () => {
    expect(
      [
        TeamPanel,
        CommunicationGraphInspect,
        ExchangesPanel,
        RunsPanel,
        CouncilRunView,
        FinalDecisionPacketView,
      ].every((component) => typeof component === "function"),
      ).toBe(true);
    });

    it("routes composer Process actions into the existing Orchestrator Process pane", () => {
      const source = readFileSync(new URL("./OrchestratorSurface.tsx", import.meta.url), "utf8");
      expect(source).toContain('setActivePane(rootThreadId, "orchestrator-process")');
      expect(source).toContain("onOpenSessionProgressProcess={openProcessPane}");
      expect(source).toContain("setDockOpen(rootThreadId, true)");
    });

  it("matches a task-scoped sibling link for direct peer exchanges without an assignment", () => {
    const peerExchange = {
      ...exchange({ id: "peer-message", createdAt: "2026-08-01T00:00:00.000Z" }),
      senderThreadId: CHILD_B,
      targetThreadId: CHILD_C,
      artifactRefs: [],
      hopCount: 0,
      replyToMessageId: null,
    };
    const markup = renderToStaticMarkup(
      <ExchangesPanel
          exchanges={[peerExchange]}
          links={[
          {
            id: "link-bc",
            sourceThreadId: CHILD_B,
            targetThreadId: CHILD_C,
            direction: "bidirectional",
            taskId: "task-1",
            runId: null,
            state: "granted",
            } as never,
          ]}
          ownershipEdges={[edge(ROOT, CHILD_B), edge(ROOT, CHILD_C)]}
          threadLabels={new Map([
          [CHILD_B, "Child B"],
          [CHILD_C, "Child C"],
        ])}
        onOpenThread={vi.fn()}
        loading={false}
        error={null}
      />,
    );

    expect(markup).toContain("link granted");
      expect(markup).not.toContain("link unavailable in snapshot");
    });

    it("shows direct ownership delivery for Root-child exchanges without a link", () => {
      const directExchange = {
        ...exchange({ id: "root-child-message", createdAt: "2026-08-01T00:00:00.000Z" }),
        senderThreadId: ROOT,
        targetThreadId: CHILD_B,
        artifactRefs: [],
        hopCount: 0,
        replyToMessageId: null,
      };
      const markup = renderToStaticMarkup(
        <ExchangesPanel
          exchanges={[directExchange]}
          links={[]}
          ownershipEdges={[edge(ROOT, CHILD_B)]}
          threadLabels={new Map([
            [ROOT, "Root A"],
            [CHILD_B, "Child B"],
          ])}
          onOpenThread={vi.fn()}
          loading={false}
          error={null}
        />,
      );

      expect(markup).toContain("ownership direct");
      expect(markup).not.toContain("link unavailable in snapshot");
    });
  });

describe("Orchestrator thread transcript row", () => {
  it("renders thread identity and is explicitly excluded from live-output semantics", () => {
    const item = exchange({
      id: "message-1",
      assignmentId: "assignment-1",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    const markup = renderToStaticMarkup(
      <OrchestratorTranscriptProvider
        value={{
          exchangesByMessageId: new Map([["message-1", item]]),
          threadLabels: new Map([
            [ROOT, "Root A"],
            [CHILD_B, "Child B"],
          ]),
          onOpenThread: vi.fn(),
        }}
      >
        <OrchestratorThreadMessageRow
          messageId="message-1"
          text="Please expose the contract API."
        />
      </OrchestratorTranscriptProvider>,
    );

    expect(markup).toContain('data-orchestrator-exchange-row="true"');
    expect(markup).toContain('data-live-output="false"');
    expect(markup).toContain("Child B");
    expect(markup).toContain("Root A");
    expect(markup).not.toContain('data-message-role="user"');
  });
});
