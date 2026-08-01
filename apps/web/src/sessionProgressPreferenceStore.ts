import type { ThreadId } from "@synara/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SessionProgressPreferenceStoreState {
  readonly collapsedByThreadId: Record<string, boolean>;
  isCollapsed: (threadId: ThreadId) => boolean;
  setCollapsed: (threadId: ThreadId, collapsed: boolean) => void;
  prune: (threadIds: readonly ThreadId[]) => void;
}

export const useSessionProgressPreferenceStore = create<SessionProgressPreferenceStoreState>()(
  persist(
    (set, get) => ({
      collapsedByThreadId: {},
      isCollapsed: (threadId) => get().collapsedByThreadId[threadId] ?? false,
      setCollapsed: (threadId, collapsed) =>
        set((state) => {
          if ((state.collapsedByThreadId[threadId] ?? false) === collapsed) return state;
          return {
            collapsedByThreadId: { ...state.collapsedByThreadId, [threadId]: collapsed },
          };
        }),
      prune: (threadIds) =>
        set((state) => {
          const retained = new Set(threadIds);
          const next = Object.fromEntries(
            Object.entries(state.collapsedByThreadId).filter(([threadId]) =>
              retained.has(threadId as ThreadId),
            ),
          );
          return Object.keys(next).length === Object.keys(state.collapsedByThreadId).length
            ? state
            : { collapsedByThreadId: next };
        }),
    }),
    {
      name: "synara:session-progress-preferences:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ collapsedByThreadId: state.collapsedByThreadId }),
    },
  ),
);
