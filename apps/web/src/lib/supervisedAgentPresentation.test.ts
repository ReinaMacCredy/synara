import {
  AgentProfileId,
  AgentSeatId,
  EffectiveAuthorityReceiptId,
  SupervisedWorkspaceId,
  ThreadId,
  type AgentSeat,
} from "@veylen/contracts";
import { describe, expect, it } from "vitest";

import {
  collectSupervisedConversationThreadIds,
  resolvePrimarySupervisorThreadId,
} from "./supervisedAgentPresentation";

function makeSeat(overrides: Partial<AgentSeat> = {}): AgentSeat {
  const at = "2026-08-10T00:00:00.000Z";
  return {
    id: AgentSeatId.makeUnsafe("seat"),
    workspaceId: SupervisedWorkspaceId.makeUnsafe("workspace"),
    roomIds: [],
    identityRole: "supervisor",
    effectiveRole: "supervisor",
    profileId: AgentProfileId.makeUnsafe("profile"),
    providerSessionId: null,
    lifecycleState: "active",
    workState: "idle",
    authorityReceiptId: EffectiveAuthorityReceiptId.makeUnsafe("receipt"),
    threadId: ThreadId.makeUnsafe("supervisor-thread"),
    projectId: null,
    profileSnapshotId: null,
    predecessorThreadIds: [],
    displayName: "Supervisor",
    createdAt: at,
    retainedAt: null,
    retiredAt: null,
    revision: 1,
    updatedAt: at,
    ...overrides,
  };
}

describe("resolvePrimarySupervisorThreadId", () => {
  it("selects the workspace Primary Supervisor without requiring a Project id", () => {
    const secondary = makeSeat({
      id: AgentSeatId.makeUnsafe("secondary"),
      threadId: ThreadId.makeUnsafe("secondary-thread"),
    });
    const primary = makeSeat({
      id: AgentSeatId.makeUnsafe("primary"),
      concern: "primary",
      threadId: ThreadId.makeUnsafe("primary-thread"),
      projectId: null,
    });

    expect(resolvePrimarySupervisorThreadId([secondary, primary])).toBe("primary-thread");
  });

  it("does not create a duplicate conversation while the Primary Supervisor is starting", () => {
    const primary = makeSeat({ concern: "primary", lifecycleState: "bootstrapping" });

    expect(resolvePrimarySupervisorThreadId([primary])).toBe("supervisor-thread");
  });

  it("ignores terminal Supervisor seats", () => {
    const failed = makeSeat({ concern: "primary", lifecycleState: "failed" });

    expect(resolvePrimarySupervisorThreadId([failed])).toBeNull();
  });
});

describe("collectSupervisedConversationThreadIds", () => {
  it("includes Room, Supervisor, Lead, and Peer conversation threads", () => {
    const lead = makeSeat({
      id: AgentSeatId.makeUnsafe("lead"),
      identityRole: "lead",
      threadId: ThreadId.makeUnsafe("lead-thread"),
    });
    const peer = makeSeat({
      id: AgentSeatId.makeUnsafe("peer"),
      identityRole: "peer",
      threadId: ThreadId.makeUnsafe("peer-thread"),
    });

    expect([
      ...collectSupervisedConversationThreadIds({
        roomIds: ["room-thread"],
        seats: [makeSeat(), lead, peer],
      }),
    ]).toEqual(["room-thread", "supervisor-thread", "lead-thread", "peer-thread"]);
  });
});
