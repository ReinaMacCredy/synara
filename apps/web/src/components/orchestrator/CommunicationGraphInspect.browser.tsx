import "../../index.css";

import {
  ThreadId,
  type OrchestratorCommunicationLink,
  type OrchestratorOwnershipEdge,
} from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { CommunicationGraphInspect } from "./CommunicationGraphInspect";

const ROOT = ThreadId.makeUnsafe("root-a");
const CHILD_B = ThreadId.makeUnsafe("child-b");
const CHILD_C = ThreadId.makeUnsafe("child-c");
const UNATTACHED = ThreadId.makeUnsafe("child-unattached");

function edge(parentThreadId: typeof ROOT, childThreadId: typeof ROOT): OrchestratorOwnershipEdge {
  return {
    parentThreadId,
    childThreadId,
    activeFrom: "2026-08-02T00:00:00.000Z",
    retiredAt: null,
  } as OrchestratorOwnershipEdge;
}

const labels = new Map([
  [ROOT, "Root A"],
  [CHILD_B, "Child B"],
  [CHILD_C, "Child C"],
]);

describe("CommunicationGraphInspect", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows direct Root-child reachability separately from an empty explicit-link set", async () => {
    await render(
      <CommunicationGraphInspect
        rootThreadId={ROOT}
        selectedThreadId={ROOT}
        links={[]}
        ownershipEdges={[edge(ROOT, CHILD_B), edge(ROOT, CHILD_C)]}
        threadLabels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    expect(document.body.textContent).toContain("0 explicit links");
    await page.getByText("Communication routes").click();

    expect(document.querySelectorAll('[data-communication-route="ownership-direct"]')).toHaveLength(
      2,
    );
    expect(document.querySelectorAll('[data-communication-route="explicit-link"]')).toHaveLength(0);
    expect(document.body.textContent).toContain("Implicit ownership routes");
    expect(document.body.textContent).toContain("Root A");
    expect(document.body.textContent).toContain("Child B");
    expect(document.body.textContent).toContain("Child C");
    expect(document.body.textContent).toContain("No explicit sibling or cross-branch links.");
    expect(document.body.textContent).not.toContain("No links touch the selected thread.");
  });

  it("keeps one explicit sibling link distinct from both ownership routes", async () => {
    const siblingLink = {
      id: "link-bc",
      sourceThreadId: CHILD_B,
      targetThreadId: CHILD_C,
      direction: "bidirectional",
      state: "granted",
      taskId: "task-1",
      runId: null,
      reason: "Sibling review",
      expiresAt: null,
    } as OrchestratorCommunicationLink;

    await render(
      <CommunicationGraphInspect
        rootThreadId={ROOT}
        selectedThreadId={ROOT}
        links={[siblingLink]}
        ownershipEdges={[edge(ROOT, CHILD_B), edge(ROOT, CHILD_C)]}
        threadLabels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    expect(document.body.textContent).toContain("1 explicit link");
    await page.getByText("Communication routes").click();

    expect(document.querySelectorAll('[data-communication-route="ownership-direct"]')).toHaveLength(
      2,
    );
    expect(document.querySelectorAll('[data-communication-route="explicit-link"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("Sibling review");
  });

  it("shows only the direct parent route when a child is selected", async () => {
    await render(
      <CommunicationGraphInspect
        rootThreadId={ROOT}
        selectedThreadId={CHILD_B}
        links={[]}
        ownershipEdges={[edge(ROOT, CHILD_B), edge(ROOT, CHILD_C)]}
        threadLabels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    await page.getByText("Communication routes").click();

    expect(document.querySelectorAll('[data-communication-route="ownership-direct"]')).toHaveLength(
      1,
    );
    expect(document.body.textContent).toContain("Root A");
    expect(document.body.textContent).toContain("Child B");
    expect(document.body.textContent).not.toContain("Child C");
    expect(document.body.textContent).toContain("0 explicit links");
  });

  it("reports no implicit route for an unattached selected thread", async () => {
    await render(
      <CommunicationGraphInspect
        rootThreadId={ROOT}
        selectedThreadId={UNATTACHED}
        links={[]}
        ownershipEdges={[edge(ROOT, CHILD_B), edge(ROOT, CHILD_C)]}
        threadLabels={labels}
        onOpenThread={vi.fn()}
      />,
    );

    await page.getByText("Communication routes").click();

    expect(document.querySelectorAll('[data-communication-route="ownership-direct"]')).toHaveLength(
      0,
    );
    expect(document.body.textContent).toContain(
      "No direct ownership routes touch the selected thread.",
    );
    expect(document.body.textContent).toContain("No explicit sibling or cross-branch links.");
  });
});
