import {
  EventId,
  ProjectTaskId,
  TaskBlockerId,
  TaskDependencyEdgeId,
  type OrchestrationReadModel,
  type ProjectTask,
  type TaskDependencyEdge,
  type TaskGraphMutationResult,
  type TaskProcess,
  type TaskProcessCommand,
  type TaskProcessDomainEvent,
} from "@synara/contracts";
import { Effect } from "effect";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { dependencyDescendants, validateDependencySet } from "./dependencyGraph.ts";
import {
  activeOwnerBindingForThread,
  canTransitionTaskLifecycle,
  wouldCreateTaskHierarchyCycle,
} from "./invariants.ts";
import { projectTaskProcessEvent, type TaskProcessAggregateState } from "./projector.ts";

type UnsequencedTaskProcessEvent = Omit<TaskProcessDomainEvent, "sequence">;

const reject = (commandType: string, detail: string) =>
  Effect.fail(new OrchestrationCommandInvariantError({ commandType, detail }));

const emptyMutation = (revision: number): TaskGraphMutationResult => ({
  graphRevision: revision,
  affectedTasks: [],
  newlyReadyTasks: [],
  newlyBlockedTasks: [],
});

const event = (input: {
  readonly command: TaskProcessCommand;
  readonly process: TaskProcess;
  readonly type: TaskProcessDomainEvent["type"];
  readonly payload?: Partial<TaskProcessDomainEvent["payload"]>;
}): UnsequencedTaskProcessEvent => ({
  eventId: EventId.makeUnsafe(crypto.randomUUID()),
  aggregateKind: "task_process",
  aggregateId: input.command.processId,
  type: input.type,
  payload: {
    processId: input.command.processId,
    projectId: input.command.projectId,
    actor: input.command.actor,
    acceptedRevision: input.process.revision,
    mutation: emptyMutation(input.process.revision),
    process: input.process,
    ...input.payload,
  },
  occurredAt: input.command.createdAt,
  commandId: input.command.commandId,
  causationEventId: null,
  correlationId: input.command.commandId,
  metadata: {},
});

const taskById = (state: TaskProcessAggregateState, taskId: ProjectTaskId) =>
  state.tasks.find((projection) => projection.task.id === taskId)?.task ?? null;

const ownerCanMutate = (state: TaskProcessAggregateState, command: TaskProcessCommand): boolean => {
  const owner = state.process?.owner;
  if (!owner) return false;
  return owner.kind === "user" && command.actor.kind === "user";
};

const updatedProcess = (
  state: TaskProcessAggregateState,
  command: TaskProcessCommand,
  patch: Partial<TaskProcess> = {},
): TaskProcess => ({
  ...state.process!,
  ...patch,
  revision: state.revision + 1,
  updatedAt: command.createdAt,
});

const attachMutation = (input: {
  readonly state: TaskProcessAggregateState;
  readonly events: ReadonlyArray<UnsequencedTaskProcessEvent>;
  readonly affectedTasks: ReadonlyArray<ProjectTaskId>;
}): ReadonlyArray<UnsequencedTaskProcessEvent> => {
  let sequence = input.state.highWaterSequence;
  const finalState = input.events.reduce((current, next) => {
    sequence += 1;
    return projectTaskProcessEvent(current, { ...next, sequence });
  }, input.state);
  const before = new Map(
    input.state.tasks.map((projection) => [projection.task.id, projection.readiness]),
  );
  const newlyReadyTasks = finalState.tasks
    .filter(
      (projection) =>
        before.get(projection.task.id) !== "ready" && projection.readiness === "ready",
    )
    .map((projection) => projection.task.id);
  const newlyBlockedTasks = finalState.tasks
    .filter(
      (projection) =>
        before.get(projection.task.id) === "ready" && projection.readiness === "blocked",
    )
    .map((projection) => projection.task.id);
  const mutation: TaskGraphMutationResult = {
    graphRevision: finalState.revision,
    affectedTasks: [...new Set(input.affectedTasks)],
    newlyReadyTasks,
    newlyBlockedTasks,
  };
  return input.events.map((next) => ({
    ...next,
    payload: { ...next.payload, mutation },
  }));
};

const single = (events: ReadonlyArray<UnsequencedTaskProcessEvent>) =>
  events.length === 1 ? events[0]! : events;

export const decideTaskProcessCommand = Effect.fn("decideTaskProcessCommand")(function* (input: {
  readonly command: TaskProcessCommand;
  readonly state: TaskProcessAggregateState;
  readonly readModel: OrchestrationReadModel;
}): Effect.fn.Return<
  UnsequencedTaskProcessEvent | ReadonlyArray<UnsequencedTaskProcessEvent>,
  OrchestrationCommandInvariantError
> {
  const { command, state, readModel } = input;
  if (command.type === "task-process.create") {
    if (state.process !== null || command.expectedRevision !== 0) {
      return yield* reject(
        command.type,
        "TaskProcess already exists or expectedRevision is not zero.",
      );
    }
    const project = readModel.projects.find(
      (candidate) => candidate.id === command.projectId && candidate.deletedAt === null,
    );
    if (project?.kind !== "project") {
      return yield* reject(
        command.type,
        "TaskProcess requires a real Project.",
      );
    }
    if (command.actor.kind !== "user") {
      return yield* reject(command.type, "Process creator does not match the declared owner.");
    }
    const process: TaskProcess = {
      id: command.processId,
      projectId: command.projectId,
      title: command.title,
      owner: command.owner,
      state: "active",
      revision: 1,
      createdAt: command.createdAt,
      updatedAt: command.createdAt,
    };
    return event({ command, process, type: "task-process.created" });
  }

  if (state.process === null) return yield* reject(command.type, "TaskProcess does not exist.");
  if (state.process.id !== command.processId || state.process.projectId !== command.projectId) {
    return yield* reject(command.type, "Command does not match TaskProcess project and identity.");
  }
  if (state.revision !== command.expectedRevision) {
    return yield* reject(
      command.type,
      `Revision conflict: expected ${command.expectedRevision}, current ${state.revision}.`,
    );
  }

  const process = updatedProcess(state, command);
  const finish = (
    raw: ReadonlyArray<UnsequencedTaskProcessEvent>,
    affectedTasks: ReadonlyArray<ProjectTaskId> = [],
  ) => single(attachMutation({ state, events: raw, affectedTasks }));

  if (command.type === "task-process.pause") {
    if (!ownerCanMutate(state, command) || state.process.state !== "active") {
      return yield* reject(command.type, "Only the process owner may pause an active process.");
    }
    return finish([
      event({
        command,
        process: { ...process, state: "paused" },
        type: "task-process.paused",
        payload: { reason: command.reason },
      }),
    ]);
  }
  if (command.type === "task-process.resume") {
    if (!ownerCanMutate(state, command) || state.process.state !== "paused") {
      return yield* reject(command.type, "Only the process owner may resume a paused process.");
    }
    return finish([
      event({ command, process: { ...process, state: "active" }, type: "task-process.resumed" }),
    ]);
  }
  if (command.type === "task-process.complete") {
    const allTerminal =
      state.tasks.length > 0 &&
      state.tasks.every(({ task }) => task.lifecycle === "done" || task.lifecycle === "cancelled");
    if (!ownerCanMutate(state, command) || state.process.state !== "active" || !allTerminal) {
      return yield* reject(
        command.type,
        "Process completion requires owner authority and terminal tasks.",
      );
    }
    return finish([
      event({
        command,
        process: { ...process, state: "completed" },
        type: "task-process.completed",
      }),
    ]);
  }
  if (command.type === "task-process.archive") {
    if (!ownerCanMutate(state, command) || state.process.state === "archived") {
      return yield* reject(command.type, "Only the process owner may archive a live process.");
    }
    return finish([
      event({ command, process: { ...process, state: "archived" }, type: "task-process.archived" }),
    ]);
  }

  if (state.process.state !== "active") {
    return yield* reject(command.type, "Task mutation requires an active process.");
  }

  if (command.type === "project-task.progress.report") {
    const task = taskById(state, command.taskId);
    if (!task) return yield* reject(command.type, "Task does not exist.");
    const actorThreadId = command.actor.kind === "thread" ? command.actor.threadId : null;
    const actorAuthorized =
      ownerCanMutate(state, command) ||
      (actorThreadId !== null &&
        command.threadId === actorThreadId &&
        state.bindings.some(
          (binding) =>
            binding.taskId === command.taskId &&
            binding.threadId === actorThreadId &&
            binding.retiredAt === null,
        ));
    if (!actorAuthorized)
      return yield* reject(command.type, "Progress actor is not actively bound to the task.");
    if (state.progress.some((entry) => entry.id === command.progressId)) {
      return yield* reject(command.type, "Progress identity already exists.");
    }
    const progress = {
      id: command.progressId,
      taskId: command.taskId,
      assignmentId: command.assignmentId,
      threadId: command.threadId,
      actor: command.actor,
      kind: command.kind,
      summary: command.summary,
      evidenceRefs: command.evidenceRefs,
      createdAt: command.createdAt,
    } as const;
    const blocker =
      command.kind === "blocker"
        ? {
            id: TaskBlockerId.makeUnsafe(`blocker:${command.progressId}`),
            taskId: command.taskId,
            kind: "external" as const,
            summary: command.summary,
            createdBy: command.actor,
            createdAt: command.createdAt,
            resolvedBy: null,
            resolvedAt: null,
            resolution: null,
          }
        : undefined;
    return finish(
      [
        event({
          command,
          process,
          type: "project-task.progress-reported",
          payload: { progress, ...(blocker ? { blocker } : {}) },
        }),
      ],
      [command.taskId],
    );
  }

  if (!ownerCanMutate(state, command)) {
    return yield* reject(command.type, "Task mutation requires process-owner authority.");
  }

  switch (command.type) {
    case "project-task.create": {
      if (taskById(state, command.taskId))
        return yield* reject(command.type, "Task identity already exists.");
      if (command.parentTaskId !== null && !taskById(state, command.parentTaskId)) {
        return yield* reject(command.type, "Parent task does not exist.");
      }
      const task: ProjectTask = {
        id: command.taskId,
        processId: command.processId,
        parentTaskId: command.parentTaskId,
        title: command.title,
        description: command.description,
        acceptanceCriteria: command.acceptanceCriteria,
        priority: command.priority,
        risk: command.risk,
        lifecycle: "planned",
        orderKey: command.orderKey,
        createdBy: command.actor,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };
      return finish(
        [event({ command, process, type: "project-task.created", payload: { task } })],
        [task.id],
      );
    }

    case "project-task.meta.update": {
      const current = taskById(state, command.taskId);
      if (!current) return yield* reject(command.type, "Task does not exist.");
      const parentTaskId =
        command.parentTaskId === undefined ? current.parentTaskId : command.parentTaskId;
      if (parentTaskId !== null && !taskById(state, parentTaskId)) {
        return yield* reject(command.type, "Parent task does not exist.");
      }
      if (wouldCreateTaskHierarchyCycle({ state, taskId: command.taskId, parentTaskId })) {
        return yield* reject(command.type, "Task hierarchy update would create a cycle.");
      }
      const task: ProjectTask = {
        ...current,
        parentTaskId,
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.description !== undefined ? { description: command.description } : {}),
        ...(command.acceptanceCriteria !== undefined
          ? { acceptanceCriteria: command.acceptanceCriteria }
          : {}),
        ...(command.priority !== undefined ? { priority: command.priority } : {}),
        ...(command.risk !== undefined ? { risk: command.risk } : {}),
        updatedAt: command.createdAt,
      };
      return finish(
        [event({ command, process, type: "project-task.meta-updated", payload: { task } })],
        [task.id],
      );
    }

    case "project-task.reorder": {
      const current = taskById(state, command.taskId);
      if (!current) return yield* reject(command.type, "Task does not exist.");
      const task = { ...current, orderKey: command.orderKey, updatedAt: command.createdAt };
      return finish(
        [event({ command, process, type: "project-task.reordered", payload: { task } })],
        [task.id],
      );
    }

    case "project-task.dependencies.set": {
      const issue = validateDependencySet({
        processId: command.processId,
        taskId: command.taskId,
        prerequisiteTaskIds: command.prerequisiteTaskIds,
        tasks: state.tasks.map((projection) => projection.task),
        existingDependencies: state.dependencies,
      });
      if (issue) return yield* reject(command.type, `${issue.code}: ${issue.reason}`);
      const requested = new Set(command.prerequisiteTaskIds);
      const currentActive = state.dependencies.filter(
        (edge) => edge.dependentTaskId === command.taskId && edge.state === "active",
      );
      const changes: TaskDependencyEdge[] = currentActive
        .filter((edge) => !requested.has(edge.prerequisiteTaskId))
        .map((edge) => ({
          ...edge,
          state: "waived",
          waivedBy: command.actor,
          waivedAt: command.createdAt,
          waiverReason: "Replaced by an explicit dependency set.",
        }));
      for (const prerequisiteTaskId of command.prerequisiteTaskIds) {
        if (currentActive.some((edge) => edge.prerequisiteTaskId === prerequisiteTaskId)) continue;
        changes.push({
          id: TaskDependencyEdgeId.makeUnsafe(
            `dependency:${command.processId}:${command.taskId}:${prerequisiteTaskId}:${process.revision}`,
          ),
          processId: command.processId,
          dependentTaskId: command.taskId,
          prerequisiteTaskId,
          state: "active",
          createdBy: command.actor,
          createdAt: command.createdAt,
          waivedBy: null,
          waivedAt: null,
          waiverReason: null,
        });
      }
      const raw =
        changes.length > 0
          ? changes.map((dependency) =>
              event({
                command,
                process,
                type: "project-task.dependencies-set",
                payload: { dependency },
              }),
            )
          : [
              event({
                command,
                process,
                type: "project-task.dependencies-set",
                payload: { task: taskById(state, command.taskId)! },
              }),
            ];
      return finish(raw, [command.taskId]);
    }

    case "project-task.dependency.waive": {
      const current = state.dependencies.find((edge) => edge.id === command.edgeId);
      if (!current || current.state !== "active") {
        return yield* reject(command.type, "Dependency does not exist or is not active.");
      }
      const dependency: TaskDependencyEdge = {
        ...current,
        state: "waived",
        waivedBy: command.actor,
        waivedAt: command.createdAt,
        waiverReason: command.reason,
      };
      return finish(
        [
          event({
            command,
            process,
            type: "project-task.dependency-waived",
            payload: { dependency, reason: command.reason },
          }),
        ],
        [current.dependentTaskId],
      );
    }

    case "project-task.thread.bind": {
      if (state.bindings.some((binding) => binding.id === command.bindingId)) {
        return yield* reject(command.type, "Binding identity already exists.");
      }
      const task = taskById(state, command.taskId);
      const thread = readModel.threads.find(
        (candidate) =>
          candidate.id === command.threadId &&
          candidate.projectId === command.projectId &&
          candidate.deletedAt === null,
      );
      if (!task || !thread || thread.subagentAgentId) {
        return yield* reject(
          command.type,
          "Binding requires a task and standalone thread in the project.",
        );
      }
      if (
        command.role === "owner" &&
        (activeOwnerBindingForThread(state, command.threadId) !== null ||
          state.bindings.some(
            (binding) =>
              binding.taskId === command.taskId &&
              binding.role === "owner" &&
              binding.retiredAt === null,
          ))
      ) {
        return yield* reject(
          command.type,
          "Owner binding conflicts with an active task or thread owner.",
        );
      }
      const binding = {
        id: command.bindingId,
        taskId: command.taskId,
        threadId: command.threadId,
        assignmentId: command.assignmentId,
        role: command.role,
        activeFrom: command.createdAt,
        retiredAt: null,
      } as const;
      return finish(
        [event({ command, process, type: "project-task.thread-bound", payload: { binding } })],
        [command.taskId],
      );
    }

    case "project-task.thread.unbind": {
      const current = state.bindings.find(
        (binding) => binding.id === command.bindingId && binding.taskId === command.taskId,
      );
      if (!current || current.retiredAt !== null)
        return yield* reject(command.type, "Active binding does not exist.");
      return finish(
        [
          event({
            command,
            process,
            type: "project-task.thread-unbound",
            payload: { binding: { ...current, retiredAt: command.createdAt } },
          }),
        ],
        [command.taskId],
      );
    }

    case "project-task.blocker.resolve": {
      const blocker = state.blockers.find(
        (candidate) => candidate.id === command.blockerId && candidate.taskId === command.taskId,
      );
      if (!blocker || blocker.resolvedAt !== null)
        return yield* reject(command.type, "Open blocker does not exist.");
      return finish(
        [
          event({
            command,
            process,
            type: "project-task.blocker-resolved",
            payload: {
              blocker: {
                ...blocker,
                resolvedBy: command.actor,
                resolvedAt: command.createdAt,
                resolution: command.resolution,
              },
            },
          }),
        ],
        [command.taskId],
      );
    }

    case "project-task.transition": {
      const current = taskById(state, command.taskId);
      const currentProjection = state.tasks.find(
        (projection) => projection.task.id === command.taskId,
      );
      if (!current || !canTransitionTaskLifecycle(current.lifecycle, command.lifecycle)) {
        return yield* reject(
          command.type,
          "Task does not exist or lifecycle transition is illegal.",
        );
      }
      if (command.lifecycle === "in_progress" && currentProjection?.readiness !== "ready") {
        return yield* reject(command.type, "A blocked task cannot enter in_progress.");
      }
      const task = { ...current, lifecycle: command.lifecycle, updatedAt: command.createdAt };
      return finish(
        [
          event({
            command,
            process,
            type: "project-task.transitioned",
            payload: { task, reason: command.reason },
          }),
        ],
        [command.taskId],
      );
    }

    case "project-task.complete": {
      const current = taskById(state, command.taskId);
      const evidenceOkay =
        command.evidenceRefs.length > 0 &&
        (state.process.owner.kind === "user" || command.assignmentIds.length > 0);
      if (
        !current ||
        (current.lifecycle !== "in_progress" && current.lifecycle !== "review") ||
        !evidenceOkay
      ) {
        return yield* reject(
          command.type,
          "Task completion requires active work and explicit evidence.",
        );
      }
      const task = { ...current, lifecycle: "done" as const, updatedAt: command.createdAt };
      return finish(
        [event({ command, process, type: "project-task.completed", payload: { task } })],
        [command.taskId],
      );
    }

    case "project-task.reopen": {
      const current = taskById(state, command.taskId);
      if (!current || !["done", "failed", "cancelled"].includes(current.lifecycle)) {
        return yield* reject(command.type, "Only terminal tasks may be reopened.");
      }
      const task = { ...current, lifecycle: "planned" as const, updatedAt: command.createdAt };
      const descendants = dependencyDescendants({
        sourceTaskId: command.taskId,
        dependencies: state.dependencies,
      });
      const invalidated = descendants
        .map((taskId) => taskById(state, taskId))
        .filter((candidate): candidate is ProjectTask => candidate !== null)
        .filter((candidate) => ["in_progress", "review", "done"].includes(candidate.lifecycle));
      return finish(
        [
          event({
            command,
            process,
            type: "project-task.reopened",
            payload: { task, reason: command.reason },
          }),
          ...invalidated.map((dependent) =>
            event({
              command,
              process,
              type: "project-task.dependency-invalidated",
              payload: { task: dependent, reason: command.reason },
            }),
          ),
        ],
        [command.taskId, ...descendants],
      );
    }
  }
});
