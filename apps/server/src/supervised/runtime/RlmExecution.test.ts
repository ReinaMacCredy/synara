import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { OrchestrationThread } from "@synara/contracts";

import {
  buildRlmSynthesisPrompt,
  extractRlmThreadResult,
  promptReceiptHash,
} from "./RlmExecution.ts";

const now = "2026-08-09T00:00:00.000Z";
const thread = {
  id: "thread:branch",
  projectId: "project:stage-5",
  title: "RLM branch",
  modelSelection: { provider: "codex", model: "gpt-5.6-sol", options: {} },
  runtimeMode: "full-access",
  interactionMode: "default",
  envMode: "local",
  branch: null,
  worktreePath: null,
  workingDirectory: "/tmp/stage-5",
  associatedWorktreePath: null,
  associatedWorktreeBranch: null,
  associatedWorktreeRef: null,
  createBranchFlowCompleted: false,
  isPinned: false,
  parentThreadId: "thread:root",
  creationSource: "supervised_native",
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
  latestTurn: {
    turnId: "turn:branch",
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: "2026-08-09T00:00:02.000Z",
    assistantMessageId: "message:assistant",
  },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledAt: null,
  deletedAt: null,
  handoff: null,
  messages: [
    {
      id: "message:prompt",
      role: "thread",
      text: "Investigate branch.",
      turnId: "turn:branch",
      streaming: false,
      source: "native",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "message:assistant",
      role: "assistant",
      text: "The branch produced retained evidence.",
      turnId: "turn:branch",
      streaming: false,
      source: "native",
      createdAt: "2026-08-09T00:00:02.000Z",
      updatedAt: "2026-08-09T00:00:02.000Z",
    },
  ],
  proposedPlans: [],
  activities: [
    {
      id: "activity:tool-started",
      tone: "tool",
      kind: "tool.started",
      summary: "Search started",
      payload: {
        status: "running",
        data: { toolCallId: "call:1", toolName: "search", input: { query: "RLM evidence" } },
      },
      turnId: "turn:branch",
      createdAt: "2026-08-09T00:00:00.500Z",
    },
    {
      id: "activity:tool",
      tone: "tool",
      kind: "tool.completed",
      summary: "Search completed",
      payload: {
        status: "completed",
        data: { toolCallId: "call:1", toolName: "search", output: "Retained source" },
      },
      turnId: "turn:branch",
      createdAt: "2026-08-09T00:00:01.000Z",
    },
    {
      id: "activity:context",
      tone: "info",
      kind: "context-window.updated",
      summary: "Context updated",
      payload: { usedTokens: 12_000, maxTokens: 128_000, usedPercent: 9.375 },
      turnId: "turn:branch",
      createdAt: "2026-08-09T00:00:01.500Z",
    },
    {
      id: "activity:turn",
      tone: "info",
      kind: "turn.completed",
      summary: "Turn completed",
      payload: {
        modelUsage: { "gpt-5.6-sol": { inputTokens: 100, outputTokens: 50 } },
        totalCostUsd: 0.02,
        detail: "Turn completed",
      },
      turnId: "turn:branch",
      createdAt: "2026-08-09T00:00:02.000Z",
    },
  ],
  pendingInteractions: [],
  checkpoints: [],
  session: {
    threadId: "thread:branch",
    status: "ready",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: now,
  },
} as unknown as OrchestrationThread;

describe("real RLM execution evidence", () => {
  it("extracts visible transcript, tool lifecycle, and provider usage without hidden reasoning", () => {
    const result = extractRlmThreadResult(thread);
    assert.equal(result.status, "completed");
    assert.equal(result.response, "The branch produced retained evidence.");
    assert.equal(result.providerCallId, "turn:branch");
    assert.equal(result.terminalSourceEventId, "activity:turn");
    assert.equal(result.durationMs, 2_000);
    assert.equal(result.costUsd, 0.02);
    assert.equal(result.error, null);
    assert.deepEqual(result.sourceEventIds, ["activity:tool", "activity:context", "activity:turn"]);
    assert.deepEqual(result.usage, {
      inputTokens: 100,
      outputTokens: 50,
      contextTokens: 12_000,
      providerLimitTokens: 128_000,
      contextUsagePercent: 9.375,
    });
    assert.deepEqual(result.usageProvenance, {
      inputOutputTokens: "provider_observed",
      contextWindow: "provider_observed",
    });
    const toolCalls = result.items.filter((item) => item.type === "tool_call");
    const toolResults = result.items.filter((item) => item.type === "tool_result");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]?.callId, "call:1");
    assert.equal(toolCalls[0]?.status, "completed");
    assert.equal(toolResults.length, 1);
    assert.equal(toolResults[0]?.outputSummary, "Retained source");
    assert.equal(
      result.items.some((item) => item.type === "message" && item.reasoningSummary !== null),
      false,
    );
  });

  it("retains a terminal provider error and never emits an invalid duration", () => {
    const result = extractRlmThreadResult({
      ...thread,
      latestTurn: {
        ...thread.latestTurn!,
        state: "error",
        requestedAt: "not-a-date",
        completedAt: "also-not-a-date",
      },
      activities: [
        {
          id: "activity:failed-turn",
          tone: "error",
          kind: "turn.completed",
          summary: "Turn failed",
          payload: { state: "failed", errorMessage: "Provider capacity exhausted" },
          turnId: "turn:branch",
          createdAt: "2026-08-09T00:00:02.000Z",
        },
      ],
      session: { ...thread.session!, status: "error", lastError: null },
    } as unknown as OrchestrationThread);

    assert.equal(result.status, "failed");
    assert.equal(result.error, "Provider capacity exhausted");
    assert.equal(result.durationMs, null);
    assert.equal(result.terminalSourceEventId, "activity:failed-turn");
    assert.deepEqual(result.sourceEventIds, ["activity:failed-turn"]);
    assert.deepEqual(result.usageProvenance, {
      inputOutputTokens: "unavailable",
      contextWindow: "unavailable",
    });
  });

  it("keeps provider usage and receipt lineage unavailable when projection has no source events", () => {
    const result = extractRlmThreadResult({
      ...thread,
      activities: [],
    } as OrchestrationThread);

    assert.equal(result.status, "completed");
    assert.equal(result.response, "The branch produced retained evidence.");
    assert.equal(result.terminalSourceEventId, null);
    assert.deepEqual(result.sourceEventIds, []);
    assert.deepEqual(result.usage, {
      inputTokens: 0,
      outputTokens: 0,
      contextTokens: 0,
      providerLimitTokens: null,
      contextUsagePercent: null,
    });
    assert.deepEqual(result.usageProvenance, {
      inputOutputTokens: "unavailable",
      contextWindow: "unavailable",
    });
  });

  it("keeps repeated provider call ids distinct across retry turns", () => {
    const repeatedCall = {
      ...thread.activities[1]!,
      id: "activity:prior-tool",
      turnId: "turn:prior-attempt",
      createdAt: "2026-08-08T23:59:59.000Z",
    };
    const result = extractRlmThreadResult({
      ...thread,
      activities: [repeatedCall, ...thread.activities],
    } as OrchestrationThread);

    assert.equal(result.items.filter((item) => item.type === "tool_call").length, 2);
    assert.equal(result.items.filter((item) => item.type === "tool_result").length, 2);
  });

  it("builds a synthesis prompt with explicit session and evidence lineage", () => {
    const prompt = buildRlmSynthesisPrompt({
      objective: "Answer from independent branches.",
      branches: [
        {
          title: "Branch A",
          modelSessionId: "model-session:a" as never,
          response: "A found a durable fact.",
          evidenceId: "evidence:a" as never,
        },
      ],
    });
    assert.match(prompt, /Model session: model-session:a/);
    assert.match(prompt, /Evidence: evidence:a/);
    assert.match(promptReceiptHash(prompt) ?? "", /^sha256:[a-f0-9]{64}$/);
  });

  it("bounds synthesis without dropping the final branch lineage", () => {
    const prompt = buildRlmSynthesisPrompt({
      objective: "A".repeat(10_000),
      branches: Array.from({ length: 16 }, (_, index) => ({
        title: `Branch ${index + 1}`,
        modelSessionId: `model-session:${index + 1}` as never,
        response: `${index + 1}:${"R".repeat(10_000)}`,
        evidenceId: `evidence:${index + 1}` as never,
      })),
    });

    assert.ok(prompt.length <= 32_768);
    assert.match(prompt, /Evidence: evidence:16/);
    assert.match(prompt, /16:R/);
  });
});
