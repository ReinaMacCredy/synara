import type { ProjectTaskId, TaskProcessId } from "@veylen/contracts";
import { create } from "zustand";

export type TaskProcessView = "board" | "graph";
export type TaskProcessFilter = "all" | "ready" | "blocked" | "input";

export interface TaskProcessUiState {
  readonly view: TaskProcessView;
  readonly filter: TaskProcessFilter;
  readonly selectedTaskId: ProjectTaskId | null;
}

const DEFAULT_PROCESS_UI_STATE: TaskProcessUiState = {
  view: "board",
  filter: "all",
  selectedTaskId: null,
};

interface TaskProcessStoreState {
  readonly byProcessId: Record<string, TaskProcessUiState>;
  getProcessState: (processId: TaskProcessId) => TaskProcessUiState;
  setView: (processId: TaskProcessId, view: TaskProcessView) => void;
  setFilter: (processId: TaskProcessId, filter: TaskProcessFilter) => void;
  selectTask: (processId: TaskProcessId, taskId: ProjectTaskId | null) => void;
  clearProcess: (processId: TaskProcessId) => void;
}

function updateProcessState(
  state: TaskProcessStoreState,
  processId: TaskProcessId,
  patch: Partial<TaskProcessUiState>,
): Pick<TaskProcessStoreState, "byProcessId"> {
  const current = state.byProcessId[processId] ?? DEFAULT_PROCESS_UI_STATE;
  return { byProcessId: { ...state.byProcessId, [processId]: { ...current, ...patch } } };
}

export const useTaskProcessStore = create<TaskProcessStoreState>((set, get) => ({
  byProcessId: {},
  getProcessState: (processId) => get().byProcessId[processId] ?? DEFAULT_PROCESS_UI_STATE,
  setView: (processId, view) => set((state) => updateProcessState(state, processId, { view })),
  setFilter: (processId, filter) =>
    set((state) => updateProcessState(state, processId, { filter })),
  selectTask: (processId, selectedTaskId) =>
    set((state) => updateProcessState(state, processId, { selectedTaskId })),
  clearProcess: (processId) =>
    set((state) => {
      if (!(processId in state.byProcessId)) return state;
      const next = { ...state.byProcessId };
      delete next[processId];
      return { byProcessId: next };
    }),
}));
