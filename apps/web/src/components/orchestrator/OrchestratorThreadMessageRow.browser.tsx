import "../../index.css";

import {
  OrchestratorMessageId,
  ThreadId,
  type OrchestratorMessageEnvelope,
} from "@synara/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  OrchestratorThreadMessageRow,
  OrchestratorTranscriptProvider,
} from "./OrchestratorThreadMessageRow";

describe("OrchestratorThreadMessageRow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps thread identity, navigation, and non-live semantics in the browser", async () => {
    const rootThreadId = ThreadId.makeUnsafe("root-a");
    const childThreadId = ThreadId.makeUnsafe("child-b");
    const exchange = {
      messageId: OrchestratorMessageId.makeUnsafe("message-1"),
      senderThreadId: childThreadId,
      targetThreadId: rootThreadId,
      deliveryState: "delivered",
      assignmentId: null,
      runId: null,
      correlationId: null,
    } as OrchestratorMessageEnvelope;
    const onOpenThread = vi.fn();

    await render(
      <OrchestratorTranscriptProvider
        value={{
          exchangesByMessageId: new Map([["message-1", exchange]]),
          threadLabels: new Map([
            [rootThreadId, "Root A"],
            [childThreadId, "Child B"],
          ]),
          onOpenThread,
        }}
      >
        <OrchestratorThreadMessageRow messageId="message-1" text="Requesting an API change." />
      </OrchestratorTranscriptProvider>,
    );

    const row = document.querySelector<HTMLElement>("[data-orchestrator-exchange-row]");
    expect(row?.dataset.liveOutput).toBe("false");
    expect(row?.getAttribute("role")).toBe("note");

    await page.getByRole("button", { name: "Child B" }).click();
    expect(onOpenThread).toHaveBeenCalledWith(childThreadId);
    await page.getByRole("button", { name: "Root A" }).click();
    expect(onOpenThread).toHaveBeenCalledWith(rootThreadId);
  });
});
