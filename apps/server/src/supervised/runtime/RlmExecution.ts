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

const summary = (value: unknown): string | null => {
  const direct = string(value);
  if (direct !== null) return direct;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return null;
  try {
    const encoded = JSON.stringify(value);
    return encoded && encoded !== "{}" && encoded !== "[]" ? encoded : null;
  } catch {
    return null;
  }
};

export const promptReceiptHash = (prompt: string): ModelSessionTrace["promptHash"] =>
  `sha256:${createHash("sha256").update(prompt).digest("hex")}` as ModelSessionTrace["promptHash"];

const toolIdentity = (activity: OrchestrationThread["activities"][number]) => {
  const payload = object(activity.payload);
  const data = object(payload?.data);
  return {
    callId:
      string(data?.toolUseId) ??
      string(data?.toolCallId) ??
      string(data?.callID) ??
      string(data?.callId) ??
      string(payload?.callId) ??
      activity.id,
    toolName:
      string(data?.toolName) ??
      string(payload?.title) ??
      string(payload?.itemType) ??
      activity.summary,
    inputSummary:
      summary(data?.input) ??
      summary(data?.arguments) ??
      summary(data?.args) ??
      string(payload?.detail) ??
      string(data?.summary),
    outputSummary:
      summary(data?.output) ??
      summary(data?.result) ??
      summary(data?.rawOutput) ??
      string(payload?.detail) ??
      string(data?.summary),
    errorSummary:
      summary(data?.error) ??
      summary(data?.stderr) ??
      string(payload?.detail) ??
      string(data?.summary),
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
  type ToolCallItem = Extract<ModelTranscriptItem, { readonly type: "tool_call" }>;
  type ToolResultItem = Extract<ModelTranscriptItem, { readonly type: "tool_result" }>;
  const calls = new Map<string, ToolCallItem>();
  const results = new Map<string, ToolResultItem>();
  const activities = [...thread.activities].toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }
    const tool = toolIdentity(activity);
    const lifecycleKey = `${activity.turnId ?? "no-turn"}:${tool.callId}`;
    const previous = calls.get(lifecycleKey);
    const completed = activity.kind === "tool.completed";
    const failed = completed && (tool.status === "failed" || activity.tone === "error");
    if (
      !previous ||
      completed ||
      (previous.status !== "completed" && previous.status !== "failed")
    ) {
      calls.set(lifecycleKey, {
        id: previous?.id ?? `${activity.id}:call`,
        type: "tool_call",
        callId: tool.callId,
        toolName: bounded(tool.toolName, 512),
        inputSummary: bounded(tool.inputSummary ?? previous?.inputSummary ?? activity.summary),
        status: completed ? (failed ? "failed" : "completed") : (previous?.status ?? "running"),
        finishedAt: completed ? activity.createdAt : null,
        createdAt: previous?.createdAt ?? activity.createdAt,
      });
    }
    if (completed) {
      results.set(lifecycleKey, {
        id: `${activity.id}:result`,
        type: "tool_result",
        callId: tool.callId,
        outputSummary: failed ? null : bounded(tool.outputSummary ?? activity.summary),
        errorSummary: failed ? bounded(tool.errorSummary ?? activity.summary) : null,
        createdAt: activity.createdAt,
      });
    }
  }
  return [...messages, ...calls.values(), ...results.values()]
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .slice(-10_000);
};

const usage = (
  thread: OrchestrationThread,
): {
  readonly usage: ModelSessionTrace["usage"];
  readonly provenance: ModelSessionTrace["usageProvenance"];
} => {
  let inputTokens = 0;
  let outputTokens = 0;
  let contextTokens = 0;
  let providerLimitTokens: number | null = null;
  let contextUsagePercent: number | null = null;
  let inputOutputTokensObserved = false;
  let contextWindowObserved = false;
  for (const activity of thread.activities) {
    const payload = object(activity.payload);
    if (activity.kind === "context-window.updated") {
      const observedContextTokens = number(payload?.usedTokens);
      const observedProviderLimit = number(payload?.maxTokens);
      const observedContextPercent = number(payload?.usedPercent);
      if (
        observedContextTokens !== null ||
        observedProviderLimit !== null ||
        observedContextPercent !== null
      ) {
        contextWindowObserved = true;
      }
      contextTokens = observedContextTokens ?? contextTokens;
      providerLimitTokens = observedProviderLimit ?? providerLimitTokens;
      contextUsagePercent = observedContextPercent ?? contextUsagePercent;
    }
    if (activity.kind !== "turn.completed") continue;
    const modelUsage = object(payload?.modelUsage);
    if (!modelUsage) continue;
    for (const value of Object.values(modelUsage)) {
      const model = object(value);
      const observedInputTokens = number(model?.inputTokens);
      const observedOutputTokens = number(model?.outputTokens);
      if (observedInputTokens !== null || observedOutputTokens !== null) {
        inputOutputTokensObserved = true;
      }
      inputTokens += observedInputTokens ?? 0;
      outputTokens += observedOutputTokens ?? 0;
    }
  }
  return {
    usage: {
      inputTokens,
      outputTokens,
      contextTokens,
      providerLimitTokens:
        providerLimitTokens !== null && providerLimitTokens > 0 ? providerLimitTokens : null,
      contextUsagePercent:
        contextUsagePercent !== null && contextUsagePercent <= 100
          ? contextUsagePercent
          : providerLimitTokens !== null && providerLimitTokens > 0
            ? Math.min(100, (contextTokens / providerLimitTokens) * 100)
            : null,
    },
    provenance: {
      inputOutputTokens: inputOutputTokensObserved ? "provider_observed" : "unavailable",
      contextWindow: contextWindowObserved ? "provider_observed" : "unavailable",
    },
  };
};

export interface RlmThreadResult {
  readonly status: ModelSessionTrace["status"];
  readonly response: string | null;
  readonly items: ReadonlyArray<ModelTranscriptItem>;
  readonly usage: ModelSessionTrace["usage"];
  readonly usageProvenance: ModelSessionTrace["usageProvenance"];
  readonly providerSessionId: string | null;
  readonly providerCallId: string | null;
  readonly terminalSourceEventId: OrchestrationThread["activities"][number]["id"] | null;
  readonly sourceEventIds: ReadonlyArray<OrchestrationThread["activities"][number]["id"]>;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly error: string | null;
}

export function extractRlmThreadResult(thread: OrchestrationThread): RlmThreadResult {
  const extractedUsage = usage(thread);
  const latestTurn = thread.latestTurn;
  const response =
    thread.messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !message.streaming &&
          (latestTurn === null || message.turnId === latestTurn.turnId),
      )
      .at(-1)
      ?.text.trim() ?? null;
  const terminalActivity = thread.activities
    .filter(
      (activity) =>
        (activity.kind === "turn.completed" || activity.kind === "turn.aborted") &&
        (latestTurn === null || activity.turnId === latestTurn.turnId),
    )
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    )
    .at(-1);
  const terminalPayload = object(terminalActivity?.payload);
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
  const sessionError =
    status === "failed" || status === "cancelled"
      ? (string(terminalPayload?.errorMessage) ??
        string(terminalPayload?.detail) ??
        thread.session?.lastError ??
        null)
      : null;
  const durationMs = (() => {
    if (!latestTurn?.completedAt || !latestTurn.requestedAt) return null;
    const requestedAt = Date.parse(latestTurn.requestedAt);
    const completedAt = Date.parse(latestTurn.completedAt);
    return Number.isFinite(requestedAt) && Number.isFinite(completedAt)
      ? Math.max(0, completedAt - requestedAt)
      : null;
  })();
  const costUsd = thread.activities.reduce<number | null>((current, activity) => {
    if (activity.kind !== "turn.completed") return current;
    return number(object(activity.payload)?.totalCostUsd) ?? current;
  }, null);
  const sourceEventIds: Array<OrchestrationThread["activities"][number]["id"]> = [];
  const seenSourceEventIds = new Set<string>();
  for (const activity of thread.activities) {
    if (
      activity.kind !== "turn.completed" &&
      activity.kind !== "turn.aborted" &&
      activity.kind !== "tool.completed" &&
      activity.kind !== "context-window.updated"
    ) {
      continue;
    }
    if (seenSourceEventIds.has(activity.id)) continue;
    seenSourceEventIds.add(activity.id);
    sourceEventIds.push(activity.id);
  }
  return {
    status,
    response: response && response.length > 0 ? bounded(response) : null,
    items: traceItems(thread),
    usage: extractedUsage.usage,
    usageProvenance: extractedUsage.provenance,
    providerSessionId: thread.session?.providerSessionId ?? null,
    providerCallId: latestTurn?.turnId ?? null,
    terminalSourceEventId: terminalActivity?.id ?? null,
    sourceEventIds: sourceEventIds.slice(-512),
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
    .map((branch, index) => `${branchHeaders[index]}\n${bounded(branch.response, responseBudget)}`)
    .join("\n\n");
  return bounded(`${header}\n\n${branchText}`, MAX_SYNTHESIS_PROMPT);
}
