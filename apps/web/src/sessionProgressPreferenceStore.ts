import type { ThreadId } from "@veylen/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SessionProgressPreferenceStoreState {
  readonly collapsedByThreadId: Record<string, boolean>;
  readonly dismissedFailureCursorByThreadId: Record<string, string>;
  isCollapsed: (threadId: ThreadId) => boolean;
  isFailureDismissed: (threadId: ThreadId, cursor: string) => boolean;
  setCollapsed: (threadId: ThreadId, collapsed: boolean) => void;
  dismissFailure: (threadId: ThreadId, cursor: string) => void;
  prune: (threadIds: readonly ThreadId[]) => void;
}

export const useSessionProgressPreferenceStore = create<SessionProgressPreferenceStoreState>()(
  persist(
    (set, get) => ({
      collapsedByThreadId: {},
      dismissedFailureCursorByThreadId: {},
      isCollapsed: (threadId) => get().collapsedByThreadId[threadId] ?? true,
      isFailureDismissed: (threadId, cursor) =>
        get().dismissedFailureCursorByThreadId[threadId] === cursor,
      setCollapsed: (threadId, collapsed) =>
        set((state) => {
          if ((state.collapsedByThreadId[threadId] ?? true) === collapsed) return state;
          return {
            collapsedByThreadId: { ...state.collapsedByThreadId, [threadId]: collapsed },
          };
        }),
      dismissFailure: (threadId, cursor) =>
        set((state) => ({
          dismissedFailureCursorByThreadId: {
            ...state.dismissedFailureCursorByThreadId,
            [threadId]: cursor,
          },
        })),
      prune: (threadIds) =>
        set((state) => {
          const retained = new Set(threadIds);
          const nextCollapsed = Object.fromEntries(
            Object.entries(state.collapsedByThreadId).filter(([threadId]) =>
              retained.has(threadId as ThreadId),
            ),
          );
          const nextDismissed = Object.fromEntries(
            Object.entries(state.dismissedFailureCursorByThreadId).filter(([threadId]) =>
              retained.has(threadId as ThreadId),
            ),
          );
          if (
            Object.keys(nextCollapsed).length === Object.keys(state.collapsedByThreadId).length &&
            Object.keys(nextDismissed).length ===
              Object.keys(state.dismissedFailureCursorByThreadId).length
          ) {
            return state;
          }
          return {
            collapsedByThreadId: nextCollapsed,
            dismissedFailureCursorByThreadId: nextDismissed,
          };
        }),
    }),
    {
      name: "veylen:session-progress-preferences:v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        collapsedByThreadId: state.collapsedByThreadId,
        dismissedFailureCursorByThreadId: state.dismissedFailureCursorByThreadId,
      }),
    },
  ),
);
