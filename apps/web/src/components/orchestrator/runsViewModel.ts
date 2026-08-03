import type { OrchestratorArtifact, OrchestratorRun } from "@synara/contracts";

export type RunQueueGroup = "attention" | "active" | "settled";

export interface RunQueueGroups {
  readonly attention: readonly OrchestratorRun[];
  readonly active: readonly OrchestratorRun[];
  readonly settled: readonly OrchestratorRun[];
}

export interface DecisionPacketPreview {
  readonly status: string | null;
  readonly goal: string | null;
  readonly decision: string | null;
  readonly primaryVerdictArtifactId: string | null;
  readonly shadowVerdictArtifactId: string | null;
}

const SETTLED_STATES = new Set<OrchestratorRun["state"]>([
  "decided",
  "converged",
  "cancelled",
  "packet_published",
]);

const ATTENTION_STATE_ORDER = new Map<OrchestratorRun["state"], number>([
  ["owner_review_required", 0],
  ["disputed", 1],
  ["blocked", 2],
]);

export function runQueueGroup(run: OrchestratorRun): RunQueueGroup {
  if (
    run.disposition === "owner_review_required" ||
    run.disposition === "blocked" ||
    ATTENTION_STATE_ORDER.has(run.state)
  ) {
    return "attention";
  }
  return SETTLED_STATES.has(run.state) ? "settled" : "active";
}

function compareRuns(left: OrchestratorRun, right: OrchestratorRun): number {
  const stateOrder =
    (ATTENTION_STATE_ORDER.get(left.state) ?? Number.MAX_SAFE_INTEGER) -
    (ATTENTION_STATE_ORDER.get(right.state) ?? Number.MAX_SAFE_INTEGER);
  if (stateOrder !== 0) return stateOrder;
  return (
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)
  );
}

export function groupRunsForCommandCenter(
  runs: readonly OrchestratorRun[],
  limit = 12,
): RunQueueGroups {
  const grouped: Record<RunQueueGroup, OrchestratorRun[]> = {
    attention: [],
    active: [],
    settled: [],
  };
  for (const run of runs) grouped[runQueueGroup(run)].push(run);
  return {
    attention: grouped.attention.toSorted(compareRuns).slice(0, limit),
    active: grouped.active.toSorted(compareRuns).slice(0, limit),
    settled: grouped.settled.toSorted(compareRuns).slice(0, limit),
  };
}

function recordFromJson(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(content);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function decisionPacketPreview(
  artifacts: readonly OrchestratorArtifact[],
): DecisionPacketPreview | null {
  const packet = artifacts.find((artifact) => artifact.kind === "decision_packet");
  if (!packet) return null;
  const value = recordFromJson(packet.content);
  return {
    status: nonEmptyString(value?.status),
    goal: nonEmptyString(value?.goal),
    decision: nonEmptyString(value?.decision),
    primaryVerdictArtifactId: nonEmptyString(value?.primaryVerdictArtifactId),
    shadowVerdictArtifactId: nonEmptyString(value?.shadowVerdictArtifactId),
  };
}

export function runDisplayTitle(
  run: OrchestratorRun,
  artifacts: readonly OrchestratorArtifact[],
): string {
  const goal = decisionPacketPreview(artifacts)?.goal;
  if (goal) return goal;
  const brief = artifacts.find((artifact) => artifact.kind === "brief");
  const briefValue = brief ? recordFromJson(brief.content) : null;
  return (
    nonEmptyString(briefValue?.title) ??
    nonEmptyString(briefValue?.goal) ??
    `${run.mode === "council" ? "Council" : "Collaboration"} ${run.id.slice(-8)}`
  );
}

export function councilStageIndex(state: OrchestratorRun["state"]): 0 | 1 | 2 {
  if (["draft", "active", "brief_sealed", "proposals_sealed"].includes(state)) return 0;
  if (["cross_review_sealed", "revisions_sealed", "compiled"].includes(state)) return 1;
  return 2;
}

export function parseArtifactRecord(
  artifact: OrchestratorArtifact,
): Record<string, unknown> | null {
  return recordFromJson(artifact.content);
}
