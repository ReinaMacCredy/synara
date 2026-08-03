import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ThreadId,
} from "@synara/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const PROJECT_ID = ProjectId.makeUnsafe("project-1");
const PARENT_THREAD_ID = ThreadId.makeUnsafe("thread-parent");
const ADVISOR_THREAD_ID = ThreadId.makeUnsafe("thread-advisor");

async function createParentReadModel(now: string) {
  const withProject = await Effect.runPromise(
    projectEvent(createEmptyReadModel(now), {
      sequence: 1,
      eventId: EventId.makeUnsafe("evt-project-create"),
      aggregateKind: "project",
      aggregateId: PROJECT_ID,
      type: "project.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-project-create"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("cmd-project-create"),
      metadata: {},
      payload: {
        projectId: PROJECT_ID,
        kind: "project",
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: null,
        scripts: [],
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
  return Effect.runPromise(
    projectEvent(withProject, {
      sequence: 2,
      eventId: EventId.makeUnsafe("evt-thread-create"),
      aggregateKind: "thread",
      aggregateId: PARENT_THREAD_ID,
      type: "thread.created",
      occurredAt: now,
      commandId: CommandId.makeUnsafe("cmd-thread-create"),
      causationEventId: null,
      correlationId: CommandId.makeUnsafe("cmd-thread-create"),
      metadata: {},
      payload: {
        threadId: PARENT_THREAD_ID,
        projectId: PROJECT_ID,
        title: "Parent task",
        modelSelection: { provider: "codex", model: "gpt-5.6" },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "full-access",
        envMode: "local",
        branch: null,
        worktreePath: null,
        parentThreadId: null,
        subagentAgentId: null,
        subagentNickname: null,
        subagentRole: null,
        forkSourceThreadId: null,
        sidechatSourceThreadId: null,
        handoff: null,
        createdAt: now,
        updatedAt: now,
      },
    }),
  );
}

describe("Advisor fork decision", () => {
  it("persists child identity while retaining fork provenance", async () => {
    const now = "2026-08-03T00:00:00.000Z";
    const readModel = await createParentReadModel(now);
    const result = await Effect.runPromise(
      decideOrchestrationCommand({
        command: {
          type: "thread.fork.create",
          commandId: CommandId.makeUnsafe("cmd-advisor-fork"),
          threadId: ADVISOR_THREAD_ID,
          sourceThreadId: PARENT_THREAD_ID,
          projectId: PROJECT_ID,
          title: "Advisor: API boundary",
          modelSelection: { provider: "codex", model: "gpt-5.6" },
          runtimeMode: "approval-required",
          interactionMode: "default",
          envMode: "local",
          branch: null,
          worktreePath: null,
          parentThreadId: PARENT_THREAD_ID,
          subagentNickname: "Advisor",
          subagentRole: "advisor",
          importedMessages: [],
          createdAt: now,
        },
        readModel,
      }),
    );

    const created = (Array.isArray(result) ? result : [result])[0];
    expect(created?.type).toBe("thread.created");
    if (!created || created.type !== "thread.created") return;
    expect(created.payload).toMatchObject({
      threadId: ADVISOR_THREAD_ID,
      parentThreadId: PARENT_THREAD_ID,
      subagentNickname: "Advisor",
      subagentRole: "advisor",
      forkSourceThreadId: PARENT_THREAD_ID,
      runtimeMode: "approval-required",
    });
  });
});
