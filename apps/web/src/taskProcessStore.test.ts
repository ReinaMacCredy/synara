import { ProjectTaskId, TaskProcessId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useTaskProcessStore } from "./taskProcessStore";

const processA = TaskProcessId.makeUnsafe("process-a");
const processB = TaskProcessId.makeUnsafe("process-b");
const taskA = ProjectTaskId.makeUnsafe("task-a");

describe("taskProcessStore", () => {
  beforeEach(() => useTaskProcessStore.setState({ byProcessId: {} }));

  it("keeps view state scoped by process without copying domain projections", () => {
    expect(useTaskProcessStore.getState().getProcessState(processA)).toEqual({
      view: "board",
      filter: "all",
      selectedTaskId: null,
    });

    useTaskProcessStore.getState().setView(processA, "graph");
    useTaskProcessStore.getState().setFilter(processA, "blocked");
    useTaskProcessStore.getState().selectTask(processA, taskA);

    expect(useTaskProcessStore.getState().getProcessState(processA)).toEqual({
      view: "graph",
      filter: "blocked",
      selectedTaskId: taskA,
    });
    expect(useTaskProcessStore.getState().getProcessState(processB).view).toBe("board");
  });

  it("clears only the requested process state", () => {
    useTaskProcessStore.getState().setView(processA, "graph");
    useTaskProcessStore.getState().setFilter(processB, "ready");
    useTaskProcessStore.getState().clearProcess(processA);

    expect(useTaskProcessStore.getState().getProcessState(processA).view).toBe("board");
    expect(useTaskProcessStore.getState().getProcessState(processB).filter).toBe("ready");
  });
});
