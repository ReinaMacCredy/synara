import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  TaskThreadBindingId,
  ThreadId,
  type OrchestrationReadModel,
  type TaskProcessCommand,
  type TaskProcessDomainEvent,
} from "@veylen/contracts";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { decideTaskProcessCommand } from "./decider.ts";
import {
  createEmptyTaskProcessState,
  projectTaskProcessEvent,
  type TaskProcessAggregateState,
} from "./projector.ts";

const createdAt = "2026-08-01T00:00:00.000Z";
const projectId = ProjectId.makeUnsafe("project");
const processId = TaskProcessId.makeUnsafe("process");
const threadId = ThreadId.makeUnsafe("thread");
const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  spaces: [],
  projects: [
    {
      id: projectId,
      kind: "project",
      title: "Project",
      workspaceRoot: "/workspace/project",
      defaultModelSelection: null,
      scripts: [],
      isPinned: false,
      spaceId: null,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: threadId,
      projectId,
      title: "Thread",
      modelSelection: { provider: "codex", model: "gpt-5.6-sol" },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "full-access",
      envMode: "local",
      branch: null,
      worktreePath: null,
      workingDirectory: null,
      associatedWorktreePath: null,
      associatedWorktreeBranch: null,
      associatedWorktreeRef: null,
      createBranchFlowCompleted: false,
      isPinned: false,
      parentThreadId: null,
      creationSource: null,
      sourceThreadId: null,
      sourceTurnId: null,
      gatewayOperationId: null,
      gatewayOperationIndex: null,
      subagentAgentId: null,
      subagentNickname: null,
      subagentRole: null,
      forkSourceThreadId: null,
      sidechatSourceThreadId: null,
      lastKnownPr: null,
      latestTurn: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      deletedAt: null,
      handoff: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
  updatedAt: createdAt,
};

const owner = { kind: "user" as const, actorId: "owner" };
let commandIndex = 0;
const base = (state: TaskProcessAggregateState) => ({
  commandId: CommandId.makeUnsafe(`command-${++commandIndex}`),
  processId,
  projectId,
  actor: owner,
  expectedRevision: state.revision,
  createdAt,
});
const persist = (
  state: TaskProcessAggregateState,
  result:
    | Omit<TaskProcessDomainEvent, "sequence">
    | ReadonlyArray<Omit<TaskProcessDomainEvent, "sequence">>,
) => {
  let sequence = state.highWaterSequence;
  return (Array.isArray(result) ? result : [result]).reduce((current, next) => {
    sequence += 1;
    return projectTaskProcessEvent(current, { ...next, sequence });
  }, state);
};
const dispatch = async (state: TaskProcessAggregateState, command: TaskProcessCommand) => {
  const result = await Effect.runPromise(decideTaskProcessCommand({ command, state, readModel }));
  return { result, state: persist(state, result) };
};

describe("TaskProcess decider", () => {
  it("derives readiness and durably invalidates downstream evidence on reopen", async () => {
    let state = createEmptyTaskProcessState();
    ({ state } = await dispatch(state, {
      ...base(state),
      type: "task-process.create",
      title: "Process",
      owner: { kind: "user" },
    }));
    const prerequisite = ProjectTaskId.makeUnsafe("prerequisite");
    const dependent = ProjectTaskId.makeUnsafe("dependent");
    for (const [taskId, orderKey] of [
      [prerequisite, "a"],
      [dependent, "b"],
    ] as const) {
      ({ state } = await dispatch(state, {
        ...base(state),
        type: "project-task.create",
        taskId,
        parentTaskId: null,
        title: taskId,
        description: null,
        acceptanceCriteria: ["Evidence"],
        priority: "normal",
        risk: "high",
        orderKey,
      }));
    }
    ({ state } = await dispatch(state, {
      ...base(state),
      type: "project-task.dependencies.set",
      taskId: dependent,
      prerequisiteTaskIds: [prerequisite],
    }));
    expect(state.tasks.find(({ task }) => task.id === dependent)?.readiness).toBe("blocked");

    for (const taskId of [prerequisite, dependent]) {
      ({ state } = await dispatch(state, {
        ...base(state),
        type: "project-task.transition",
        taskId,
        lifecycle: "in_progress",
        reason: null,
      }));
      ({ state } = await dispatch(state, {
        ...base(state),
        type: "project-task.complete",
        taskId,
        assignmentIds: [],
        evidenceRefs: [`evidence:${taskId}`],
      }));
    }
    expect(state.tasks.find(({ task }) => task.id === dependent)?.task.lifecycle).toBe("done");

    const reopened = await dispatch(state, {
      ...base(state),
      type: "project-task.reopen",
      taskId: prerequisite,
      reason: "Foundation changed",
    });
    state = reopened.state;
    const dependentProjection = state.tasks.find(({ task }) => task.id === dependent);
    expect(dependentProjection).toMatchObject({
      readiness: "blocked",
      evidenceState: "potentially_stale",
      task: { lifecycle: "done" },
    });
    const events = Array.isArray(reopened.result) ? reopened.result : [reopened.result];
    expect(events.map((event) => event.type)).toContain("project-task.dependency-invalidated");
    expect(events[0]?.payload.mutation.newlyBlockedTasks).toContain(dependent);
  });

  it("rejects a second active owner task for one thread", async () => {
    let state = createEmptyTaskProcessState();
    ({ state } = await dispatch(state, {
      ...base(state),
      type: "task-process.create",
      title: "Bindings",
      owner: { kind: "user" },
    }));
    const first = ProjectTaskId.makeUnsafe("first");
    const second = ProjectTaskId.makeUnsafe("second");
    for (const taskId of [first, second]) {
      ({ state } = await dispatch(state, {
        ...base(state),
        type: "project-task.create",
        taskId,
        parentTaskId: null,
        title: taskId,
        description: null,
        acceptanceCriteria: [],
        priority: "normal",
        risk: "low",
        orderKey: taskId,
      }));
    }
    ({ state } = await dispatch(state, {
      ...base(state),
      type: "project-task.thread.bind",
      bindingId: TaskThreadBindingId.makeUnsafe("binding-first"),
      taskId: first,
      threadId,
      assignmentId: null,
      role: "owner",
    }));
    const rejected = await Effect.runPromise(
      decideTaskProcessCommand({
        state,
        readModel,
        command: {
          ...base(state),
          type: "project-task.thread.bind",
          bindingId: TaskThreadBindingId.makeUnsafe("binding-second"),
          taskId: second,
          threadId,
          assignmentId: null,
          role: "owner",
        },
      }).pipe(Effect.exit),
    );
    expect(Exit.isFailure(rejected)).toBe(true);
  });
});
