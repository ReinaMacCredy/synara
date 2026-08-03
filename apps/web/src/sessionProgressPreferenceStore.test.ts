import { ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useSessionProgressPreferenceStore } from "./sessionProgressPreferenceStore";

const threadA = ThreadId.makeUnsafe("thread-a");
const threadB = ThreadId.makeUnsafe("thread-b");

describe("sessionProgressPreferenceStore", () => {
  beforeEach(() =>
    useSessionProgressPreferenceStore.setState({
      collapsedByThreadId: {},
      dismissedFailureCursorByThreadId: {},
    }),
  );

  it("persists collapse preference by thread without reacting to progress", () => {
    expect(useSessionProgressPreferenceStore.getState().isCollapsed(threadA)).toBe(true);
    useSessionProgressPreferenceStore.getState().setCollapsed(threadA, false);
    expect(useSessionProgressPreferenceStore.getState().isCollapsed(threadA)).toBe(false);
    expect(useSessionProgressPreferenceStore.getState().isCollapsed(threadB)).toBe(true);
  });

  it("prunes only preferences for threads that no longer exist", () => {
    useSessionProgressPreferenceStore.getState().setCollapsed(threadA, false);
    useSessionProgressPreferenceStore.getState().setCollapsed(threadB, false);
    useSessionProgressPreferenceStore.getState().dismissFailure(threadA, "cursor-a");
    useSessionProgressPreferenceStore.getState().dismissFailure(threadB, "cursor-b");
    useSessionProgressPreferenceStore.getState().prune([threadB]);
    expect(useSessionProgressPreferenceStore.getState().collapsedByThreadId).toEqual({
      [threadB]: false,
    });
    expect(useSessionProgressPreferenceStore.getState().dismissedFailureCursorByThreadId).toEqual({
      [threadB]: "cursor-b",
    });
  });

  it("dismisses only the current failed projection cursor", () => {
    const store = useSessionProgressPreferenceStore.getState();
    expect(store.isFailureDismissed(threadA, "cursor-a")).toBe(false);
    store.dismissFailure(threadA, "cursor-a");
    expect(
      useSessionProgressPreferenceStore.getState().isFailureDismissed(threadA, "cursor-a"),
    ).toBe(true);
    expect(
      useSessionProgressPreferenceStore.getState().isFailureDismissed(threadA, "cursor-b"),
    ).toBe(false);
  });
});
