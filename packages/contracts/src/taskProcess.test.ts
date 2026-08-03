import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  DispatchTaskProcessCommandInput,
  GetSessionProgressInput,
  ProjectTask,
  ProjectTaskCreateCommand,
  ProjectTaskCompleteCommand,
  ProjectTaskId,
  TaskGraphConflict,
  TaskProcessCommand,
  TaskProcessId,
} from "./taskProcess";
import { ProjectKind } from "./project";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

describe("TaskProcess contracts", () => {
  it.effect("keeps process and task identifiers nominally distinct", () =>
    Effect.gen(function* () {
      const processId = yield* decode(TaskProcessId, "process-1");
      const taskId = yield* decode(ProjectTaskId, "task-1");
      assert.equal(processId, "process-1");
      assert.equal(taskId, "task-1");
    }),
  );

  it("rejects the removed Studio project kind", () => {
    assert.throws(() => Schema.decodeUnknownSync(ProjectKind)("studio"));
  });

  it.effect("requires completion evidence fields", () =>
    Effect.gen(function* () {
      assert.throws(() =>
        Schema.decodeUnknownSync(ProjectTaskCompleteCommand)({
          type: "project-task.complete",
          commandId: "command-1",
          processId: "process-1",
          projectId: "project-1",
          actor: { kind: "thread", threadId: "thread-1" },
          expectedRevision: 3,
          createdAt: "2026-08-01T00:00:00.000Z",
          taskId: "task-1",
        }),
      );
    }),
  );

  it("requires explicit valid risk for every task record and create command", () => {
    const command = {
      type: "project-task.create",
      commandId: "command-risk",
      processId: "process-1",
      projectId: "project-1",
      actor: { kind: "user", actorId: "owner" },
      expectedRevision: 1,
      createdAt: "2026-08-02T00:00:00.000Z",
      taskId: "task-risk",
      parentTaskId: null,
      title: "Assess deployment",
      description: null,
      acceptanceCriteria: [],
      priority: "normal",
      orderKey: "a",
    };
    assert.throws(() => Schema.decodeUnknownSync(ProjectTaskCreateCommand)(command));
    assert.throws(() =>
      Schema.decodeUnknownSync(ProjectTaskCreateCommand)({ ...command, risk: "urgent" }),
    );
    assert.equal(
      Schema.decodeUnknownSync(ProjectTaskCreateCommand)({ ...command, risk: "high" }).risk,
      "high",
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(ProjectTask)({
        id: "task-legacy",
        processId: "process-1",
        parentTaskId: null,
        title: "Legacy task",
        description: null,
        acceptanceCriteria: [],
        priority: "normal",
        lifecycle: "planned",
        orderKey: "a",
        createdBy: { kind: "user", actorId: "owner" },
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }),
    );
  });

  it.effect("rejects unknown generic graph patch commands", () =>
    Effect.gen(function* () {
      assert.throws(() =>
        Schema.decodeUnknownSync(TaskProcessCommand)({
          type: "task-process.update",
          commandId: "command-1",
          processId: "process-1",
          projectId: "project-1",
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          patch: {},
        }),
      );
    }),
  );

  it.effect("bounds session progress reads", () =>
    Effect.gen(function* () {
      assert.throws(() =>
        Schema.decodeUnknownSync(GetSessionProgressInput)({ threadId: "thread-1", limit: 65 }),
      );
    }),
  );

  it.effect("encodes typed stale-revision conflicts", () =>
    Effect.gen(function* () {
      const conflict = yield* decode(TaskGraphConflict, {
        code: "task_process.revision_conflict",
        processId: "process-1",
        expectedRevision: 2,
        currentRevision: 3,
      });
      assert.equal(conflict.currentRevision, 3);
    }),
  );

  it.effect("wraps only explicit dispatchable task-process commands", () =>
    Effect.gen(function* () {
      const command = yield* decode(DispatchTaskProcessCommandInput, {
        command: {
          type: "task-process.create",
          commandId: "command-1",
          processId: "process-1",
          projectId: "project-1",
          actor: { kind: "user", actorId: "owner" },
          expectedRevision: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          title: "Authentication",
          owner: { kind: "user" },
        },
      });
      assert.equal(command.command.type, "task-process.create");
    }),
  );
});
