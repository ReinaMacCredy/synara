import type {
  ProjectTask,
  ProjectTaskId,
  ProjectTaskProjection,
  TaskBlocker,
  TaskDependencyEdge,
  TaskProcess,
  TaskProcessDomainEvent,
  TaskProgressEntry,
  TaskThreadBinding,
} from "@synara/contracts";

import { deriveAllTaskProjections } from "./readiness.ts";

export interface TaskProcessAggregateState {
  readonly process: TaskProcess | null;
  readonly tasks: ReadonlyArray<ProjectTaskProjection>;
  readonly dependencies: ReadonlyArray<TaskDependencyEdge>;
  readonly bindings: ReadonlyArray<TaskThreadBinding>;
  readonly progress: ReadonlyArray<TaskProgressEntry>;
  readonly blockers: ReadonlyArray<TaskBlocker>;
  readonly revision: number;
  readonly highWaterSequence: number;
}

export const createEmptyTaskProcessState = (): TaskProcessAggregateState => ({
  process: null,
  tasks: [],
  dependencies: [],
  bindings: [],
  progress: [],
  blockers: [],
  revision: 0,
  highWaterSequence: 0,
});

const upsert = <A>(
  rows: ReadonlyArray<A>,
  next: A,
  identity: (row: A) => string,
): ReadonlyArray<A> => {
  const key = identity(next);
  const index = rows.findIndex((row) => identity(row) === key);
  return index < 0 ? [...rows, next] : [...rows.slice(0, index), next, ...rows.slice(index + 1)];
};

export const projectTaskProcessEvent = (
  state: TaskProcessAggregateState,
  event: TaskProcessDomainEvent,
): TaskProcessAggregateState => {
  const tasksById = new Map(state.tasks.map((projection) => [projection.task.id, projection]));
  let canonicalTasks: ReadonlyArray<ProjectTask> = state.tasks.map((projection) => projection.task);
  let dependencies = state.dependencies;
  let bindings = state.bindings;
  let progress = state.progress;
  let blockers = state.blockers;
  const evidenceStateByTask = new Map<ProjectTaskId, ProjectTaskProjection["evidenceState"]>(
    state.tasks.map((projection) => [projection.task.id, projection.evidenceState]),
  );

  if (event.payload.task !== undefined) {
    canonicalTasks = upsert(canonicalTasks, event.payload.task, (task) => task.id);
    if (
      event.type === "project-task.dependency-invalidated" &&
      event.payload.task.lifecycle === "done"
    ) {
      evidenceStateByTask.set(event.payload.task.id, "potentially_stale");
    } else if (event.type === "project-task.completed") {
      evidenceStateByTask.set(event.payload.task.id, "current");
    } else if (!tasksById.has(event.payload.task.id)) {
      evidenceStateByTask.set(event.payload.task.id, "current");
    }
  }
  if (event.payload.dependency !== undefined) {
    dependencies = upsert(state.dependencies, event.payload.dependency, (edge) => edge.id);
  }
  if (event.payload.binding !== undefined) {
    bindings = upsert(state.bindings, event.payload.binding, (binding) => binding.id);
  }
  if (event.payload.progress !== undefined) {
    progress = upsert(state.progress, event.payload.progress, (entry) => entry.id);
  }
  if (event.payload.blocker !== undefined) {
    blockers = upsert(state.blockers, event.payload.blocker, (blocker) => blocker.id);
  }

  return {
    process: event.payload.process ?? state.process,
    tasks: deriveAllTaskProjections({
      tasks: canonicalTasks,
      dependencies,
      bindings,
      progress,
      blockers,
      evidenceStateByTask,
    }),
    dependencies,
    bindings,
    progress,
    blockers,
    revision: event.payload.acceptedRevision,
    highWaterSequence: event.sequence,
  };
};

export const replayTaskProcessEvents = (
  events: ReadonlyArray<TaskProcessDomainEvent>,
): TaskProcessAggregateState =>
  events.reduce(projectTaskProcessEvent, createEmptyTaskProcessState());
