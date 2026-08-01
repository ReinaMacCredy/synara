import { ThreadId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useSessionProgressPreferenceStore } from "./sessionProgressPreferenceStore";

const threadA = ThreadId.makeUnsafe("thread-a");
const threadB = ThreadId.makeUnsafe("thread-b");

describe("sessionProgressPreferenceStore", () => {
  beforeEach(() => useSessionProgressPreferenceStore.setState({ collapsedByThreadId: {} }));

  it("persists collapse preference by thread without reacting to progress", () => {
    expect(useSessionProgressPreferenceStore.getState().isCollapsed(threadA)).toBe(false);
    useSessionProgressPreferenceStore.getState().setCollapsed(threadA, true);
    expect(useSessionProgressPreferenceStore.getState().isCollapsed(threadA)).toBe(true);
    expect(useSessionProgressPreferenceStore.getState().isCollapsed(threadB)).toBe(false);
  });

  it("prunes only preferences for threads that no longer exist", () => {
    useSessionProgressPreferenceStore.getState().setCollapsed(threadA, true);
    useSessionProgressPreferenceStore.getState().setCollapsed(threadB, true);
    useSessionProgressPreferenceStore.getState().prune([threadB]);
    expect(useSessionProgressPreferenceStore.getState().collapsedByThreadId).toEqual({
      [threadB]: true,
    });
  });
});
