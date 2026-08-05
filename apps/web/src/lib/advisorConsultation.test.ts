import { MessageId, ThreadId, TurnId } from "@synara/contracts";
import { buildAdvisorConsultationPrompt } from "@synara/shared/advisor";
import { describe, expect, it } from "vitest";

import type { Thread, ThreadShell } from "../types";
import {
  advisorDraftInsertion,
  buildAdvisorThreadTitle,
  deriveAdvisorConsultation,
  findLatestAdvisorThreadShell,
} from "./advisorConsultation";

const parentThreadId = ThreadId.makeUnsafe("thread-parent");

function shell(input: Partial<ThreadShell> & Pick<ThreadShell, "id" | "createdAt">): ThreadShell {
  return {
    codexThreadId: null,
    projectId: "project-1" as ThreadShell["projectId"],
    title: input.title ?? "Advisor",
    modelSelection: { provider: "codex", model: "gpt-5.6" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    error: null,
    branch: null,
    worktreePath: null,
    parentThreadId,
    subagentNickname: "Advisor",
    subagentRole: "advisor",
    ...input,
  };
}

describe("Advisor consultation presentation", () => {
  it("selects only the newest Advisor child for the active parent", () => {
    const first = shell({
      id: ThreadId.makeUnsafe("advisor-1"),
      createdAt: "2026-08-03T01:00:00Z",
    });
    const second = shell({
      id: ThreadId.makeUnsafe("advisor-2"),
      createdAt: "2026-08-03T02:00:00Z",
    });
    const unrelated = shell({
      id: ThreadId.makeUnsafe("reviewer"),
      createdAt: "2026-08-03T03:00:00Z",
      title: "Reviewer",
      subagentNickname: "Reviewer",
      subagentRole: "reviewer",
    });

    expect(findLatestAdvisorThreadShell([first, unrelated, second], parentThreadId)?.id).toBe(
      second.id,
    );
  });

  it("derives the question and completed answer without reusing imported context", () => {
    const prompt = buildAdvisorConsultationPrompt("Should the retry live in the adapter?");
    const thread = {
      ...shell({ id: ThreadId.makeUnsafe("advisor-1"), createdAt: "2026-08-03T01:00:00Z" }),
      messages: [
        {
          id: MessageId.makeUnsafe("imported-answer"),
          role: "assistant",
          text: "Old parent answer",
          createdAt: "2026-08-03T00:00:00Z",
          streaming: false,
        },
        {
          id: MessageId.makeUnsafe("question"),
          role: "user",
          text: prompt,
          createdAt: "2026-08-03T01:00:00Z",
          streaming: false,
        },
        {
          id: MessageId.makeUnsafe("answer"),
          role: "assistant",
          text: "Keep it at the adapter boundary.",
          createdAt: "2026-08-03T01:01:00Z",
          streaming: false,
        },
      ],
      session: null,
      proposedPlans: [],
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-1"),
        state: "completed",
        requestedAt: "2026-08-03T01:00:00Z",
        startedAt: "2026-08-03T01:00:01Z",
        completedAt: "2026-08-03T01:01:00Z",
        assistantMessageId: MessageId.makeUnsafe("answer"),
      },
      turnDiffSummaries: [],
      activities: [],
    } as unknown as Thread;

    expect(deriveAdvisorConsultation(thread)).toMatchObject({
      question: "Should the retry live in the adapter?",
      answer: "Keep it at the adapter boundary.",
      status: "complete",
    });
    expect(advisorDraftInsertion("Use the adapter.")).toBe(
      "Advisor recommendation:\n\nUse the adapter.",
    );
    expect(buildAdvisorThreadTitle("A".repeat(80)).length).toBeLessThanOrEqual(61);
  });

  it("does not present an imported parent answer while Advisor is still working", () => {
    const prompt = buildAdvisorConsultationPrompt("Which validation should we run?");
    const thread = {
      ...shell({ id: ThreadId.makeUnsafe("advisor-running"), createdAt: "2026-08-03T01:00:00Z" }),
      messages: [
        {
          id: MessageId.makeUnsafe("imported-answer"),
          role: "assistant",
          text: "Parent answer",
          createdAt: "2026-08-03T00:00:00Z",
          streaming: false,
        },
        {
          id: MessageId.makeUnsafe("question"),
          role: "user",
          text: prompt,
          createdAt: "2026-08-03T01:00:00Z",
          streaming: false,
        },
      ],
      session: null,
      proposedPlans: [],
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-running"),
        state: "running",
        requestedAt: "2026-08-03T01:00:00Z",
        startedAt: "2026-08-03T01:00:01Z",
        completedAt: null,
        assistantMessageId: null,
      },
      turnDiffSummaries: [],
      activities: [],
    } as unknown as Thread;

    expect(deriveAdvisorConsultation(thread)).toMatchObject({
      question: "Which validation should we run?",
      answer: null,
      status: "running",
    });
  });

  it("does not reuse an imported parent answer before the Advisor prompt hydrates", () => {
    const thread = {
      ...shell({
        id: ThreadId.makeUnsafe("advisor-hydrating"),
        createdAt: "2026-08-03T01:00:00Z",
      }),
      messages: [
        {
          id: MessageId.makeUnsafe("imported-answer"),
          role: "assistant",
          text: "I will invoke the user-input prompt now.",
          createdAt: "2026-08-03T00:00:00Z",
          streaming: false,
        },
      ],
      session: null,
      proposedPlans: [],
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-hydrating"),
        state: "running",
        requestedAt: "2026-08-03T01:00:00Z",
        startedAt: "2026-08-03T01:00:01Z",
        completedAt: null,
        assistantMessageId: null,
      },
      turnDiffSummaries: [],
      activities: [],
    } as unknown as Thread;

    expect(deriveAdvisorConsultation(thread)).toMatchObject({
      question: "Agent requested a second opinion.",
      answer: null,
      status: "running",
    });
  });
});
