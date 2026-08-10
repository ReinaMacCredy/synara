import { type HandoffPreparationSnapshot, ThreadId, type HandoffDraftV1 } from "@veylen/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { resetComposerDraftStore } from "../composerDraftStoreTestFixtures";
import { applyHandoffPreparationIfActive } from "./useCrossModeHandoff";

const threadId = ThreadId.makeUnsafe("thread-handoff-destination");

function handoffDraft(): HandoffDraftV1 {
  return {
    attemptId: "attempt-1",
    preparationState: "preparing",
  } as HandoffDraftV1;
}

function cancelledSnapshot(): HandoffPreparationSnapshot {
  return {
    attemptId: "attempt-1",
    state: "cancelled",
  } as HandoffPreparationSnapshot;
}

describe("applyHandoffPreparationIfActive", () => {
  beforeEach(() => resetComposerDraftStore());

  it("does not resurrect a packet detached while preparation cancellation is in flight", () => {
    const store = useComposerDraftStore.getState();
    store.setHandoffDraft(threadId, handoffDraft());
    store.detachHandoffDraft(threadId);

    expect(applyHandoffPreparationIfActive(threadId, "project", cancelledSnapshot())).toBe(false);
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.handoffDraft).toBeFalsy();
  });
});
