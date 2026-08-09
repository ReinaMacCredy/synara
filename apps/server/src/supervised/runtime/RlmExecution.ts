import { createHash } from "node:crypto";

import type {
  Evidence,
  ModelSessionTrace,
  ModelTranscriptItem,
  OrchestrationThread,
} from "@synara/contracts";

const MAX_TRACE_TEXT = 32_768;
const MAX_SYNTHESIS_PROMPT = 32_768;

const bounded = (value: string, limit = MAX_TRACE_TEXT) =>
  value.length <= limit ? value : `${value.slice(0, limit - 16)}\n[truncated]`;

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export const promptReceiptHash = (prompt: string): ModelSessionTrace["promptHash"] =>
  `sha256:${createHash("sha256").update(prompt).digest("hex")}` as ModelSessionTrace["promptHash"];

const toolIdentity = (activity: OrchestrationThread["activities"][number]) => {
  const payload = object(activity.payload);
  const data = object(payload?.data);
  return {
    callId: string(data?.toolUseId) ?? string(data?.callId) ?? activity.id,
    toolName:
      string(data?.toolName) ?? string(payload?.title) ?? string(payload?.itemType) ?? activity.summary,
    detail: string(payload?.detail) ?? string(data?.summary),
    status: string(payload?.status),
  };
};

const traceItems = (thread: OrchestrationThread): ReadonlyArray<ModelTranscriptItem> => {
  const messages: ModelTranscriptItem[] = thread.messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "thread" && message.role !== "assistant") {
      return [];
    }
    return [
      {
        id: message.id,
        type: "message" as const,
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: bounded(message.text),
        reasoningSummary: null,
        createdAt: message.createdAt,
      },
    ];
  });
  const tools: ModelTranscriptItem[] = thread.activities.flatMap((activity) => {
    if (activity.kind === "tool.started" || activity.kind === "tool.updated") {
      const tool = toolIdentity(activity);
      return [
        {
          id: activity.id,
          type: "tool_call" as const,
          callId: tool.callId,
          toolName: bounded(tool.toolName, 512),
          inputSummary: bounded(tool.detail ?? activity.summary),
          status: activity.kind === "tool.started" ? ("running" as const) : ("pending" as const),
          finishedAt: null,
          createdAt: activity.createdAt,
        },
      ];
    }
    if (activity.kind !== "tool.completed") return [];
    const tool = toolIdentity(activity);
    const failed = tool.status === "failed" || activity.tone === "error";
    return [
      {
        id: `${activity.id}:call`,
        type: "tool_call" as const,
        callId: tool.callId,
        toolName: bounded(tool.toolName, 512),
        inputSummary: bounded(tool.detail ?? activity.summary),
        status: failed ? ("failed" as const) : ("completed" as const),
        finishedAt: activity.createdAt,
        createdAt: activity.createdAt,
      },
      {
        id: `${activity.id}:result`,
        type: "tool_result" as const,
        callId: tool.callId,
        outputSummary: failed ? null : bounded(tool.detail ?? activity.summary),
        errorSummary: failed ? bounded(tool.detail ?? activity.summary) : null,
        createdAt: activity.createdAt,
      },
    ];
  });
  return [...messages, ...tools]
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .slice(-10_000);
};

const usage = (thread: OrchestrationThread): ModelSessionTrace["usage"] => {
  let inputTokens = 0;
  let outputTokens = 0;
  let contextTokens = 0;
  let providerLimitTokens: number | null = null;
  let contextUsagePercent: number | null = null;
  for (const activity of thread.activities) {
    const payload = object(activity.payload);
    if (activity.kind === "context-window.updated") {
      contextTokens = number(payload?.usedTokens) ?? contextTokens;
      providerLimitTokens = number(payload?.maxTokens) ?? providerLimitTokens;
      contextUsagePercent = number(payload?.usedPercent) ?? contextUsagePercent;
    }
    if (activity.kind !== "turn.completed") continue;
    const modelUsage = object(payload?.modelUsage);
    if (!modelUsage) continue;
    for (const value of Object.values(modelUsage)) {
      const model = object(value);
      inputTokens += number(model?.inputTokens) ?? 0;
      outputTokens += number(model?.outputTokens) ?? 0;
    }
  }
  return {
    inputTokens,
    outputTokens,
    contextTokens,
    providerLimitTokens: providerLimitTokens !== null && providerLimitTokens > 0 ? providerLimitTokens : null,
    contextUsagePercent:
      contextUsagePercent !== null && contextUsagePercent <= 100 ? contextUsagePercent : null,
  };
};

export interface RlmThreadResult {
  readonly status: ModelSessionTrace["status"];
  readonly response: string | null;
  readonly items: ReadonlyArray<ModelTranscriptItem>;
  readonly usage: ModelSessionTrace["usage"];
  readonly providerCallId: string | null;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly error: string | null;
}

export function extractRlmThreadResult(thread: OrchestrationThread): RlmThreadResult {
  const latestTurn = thread.latestTurn;
  const response = thread.messages
    .filter(
      (message) =>
        message.role === "assistant" &&
        !message.streaming &&
        (latestTurn === null || message.turnId === latestTurn.turnId),
    )
    .at(-1)?.text.trim() ?? null;
  const sessionError = thread.session?.lastError ?? null;
  const status: ModelSessionTrace["status"] =
    latestTurn?.state === "completed"
      ? "completed"
      : latestTurn?.state === "error" || thread.session?.status === "error"
        ? "failed"
        : latestTurn?.state === "interrupted"
          ? "cancelled"
          : latestTurn?.state === "running" || thread.session?.status === "running"
            ? "running"
            : "waiting";
  const durationMs =
    latestTurn?.completedAt && latestTurn.requestedAt
      ? Math.max(0, Date.parse(latestTurn.completedAt) - Date.parse(latestTurn.requestedAt))
      : null;
  const costUsd = thread.activities.reduce<number | null>((current, activity) => {
    if (activity.kind !== "turn.completed") return current;
    return number(object(activity.payload)?.totalCostUsd) ?? current;
  }, null);
  return {
    status,
    response: response && response.length > 0 ? bounded(response) : null,
    items: traceItems(thread),
    usage: usage(thread),
    providerCallId: latestTurn?.turnId ?? null,
    durationMs,
    costUsd,
    error: sessionError,
  };
}

export function buildRlmSynthesisPrompt(input: {
  readonly objective: string;
  readonly branches: ReadonlyArray<{
    readonly title: string;
    readonly modelSessionId: ModelSessionTrace["id"];
    readonly response: string;
    readonly evidenceId: Evidence["id"];
  }>;
}): string {
  const header = [
    "You are the root synthesis session for a Synara RLM episode.",
    "Synthesize only from the visible branch transcripts below. Preserve disagreements and cite branch evidence IDs for material claims. Do not claim hidden reasoning or unlisted evidence.",
    `Objective: ${bounded(input.objective, 2_048)}`,
  ].join("\n\n");
  const branchHeaders = input.branches.map(
    (branch, index) =>
      `## Branch ${index + 1}: ${bounded(branch.title, 96)}\nModel session: ${bounded(branch.modelSessionId, 96)}\nEvidence: ${bounded(branch.evidenceId, 96)}\n`,
  );
  const structuralSize =
    header.length +
    branchHeaders.reduce((total, value) => total + value.length, 0) +
    Math.max(0, input.branches.length - 1) * 2;
  const responseBudget =
    input.branches.length === 0
      ? 0
      : Math.max(64, Math.floor((MAX_SYNTHESIS_PROMPT - structuralSize) / input.branches.length));
  const branchText = input.branches
    .map(
      (branch, index) =>
        `${branchHeaders[index]}\n${bounded(branch.response, responseBudget)}`,
    )
    .join("\n\n");
  return bounded(`${header}\n\n${branchText}`, MAX_SYNTHESIS_PROMPT);
}
