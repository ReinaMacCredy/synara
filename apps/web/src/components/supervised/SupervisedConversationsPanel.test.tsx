import { emptySupervisedRuntimeSnapshot } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SupervisedConversationsPanel } from "./SupervisedConversationsPanel";

describe("SupervisedConversationsPanel", () => {
  it("exposes the canonical conversation groups and mounts the Supervisor transcript", () => {
    const markup = renderToStaticMarkup(
      <SupervisedConversationsPanel
        roomId="room-1"
        snapshot={emptySupervisedRuntimeSnapshot("2026-08-09T00:00:00.000Z")}
        supervisorConversation={<div>Primary Supervisor transcript</div>}
        leadConversation={<div>Lead transcript</div>}
        group="supervisor"
        selectedSessionId={null}
        onGroupChange={vi.fn()}
        onSelectSession={vi.fn()}
      />,
    );

    expect(markup).toContain("Supervisor");
    expect(markup).toContain("Leads");
    expect(markup).toContain("Peers");
    expect(markup).toContain("RLM");
    expect(markup).toContain("Primary Supervisor transcript");
    expect(markup).not.toContain("Lead transcript");
  });
});
