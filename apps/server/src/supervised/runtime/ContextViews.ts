import { createHash, randomUUID } from "node:crypto";

import {
  ContextCompactionReceiptId,
  ContextRecordId,
  ContextViewId,
  type AuthorityScope,
  type ContextCompactionReceipt,
  type ContextRecord,
  type ContextView,
  type ContextWorkspace,
  type SupervisedActor,
} from "@synara/contracts";

const sameScope = (left: AuthorityScope, right: AuthorityScope) =>
  JSON.stringify(left) === JSON.stringify(right);

const recordTokenEstimate = (record: ContextRecord): number => {
  if (record.estimatedTokens > 0) return record.estimatedTokens;
  if (record.inlineText !== null) return Math.ceil(record.inlineText.length / 4);
  return record.blob === null ? 0 : Math.ceil(record.blob.sizeBytes / 4);
};

const visibleByScope = (input: {
  readonly record: ContextRecord;
  readonly workspace: ContextWorkspace;
  readonly actorSeatId: string;
  readonly allowedScopes: ReadonlyArray<AuthorityScope>;
}) => {
  const { scope } = input.record;
  if (scope.kind === "global") return true;
  if (scope.kind === "project" && scope.projectId === input.workspace.projectId) return true;
  if (scope.kind === "room" && scope.roomId === input.workspace.roomId) return true;
  if (scope.kind === "seat" && scope.seatId === input.actorSeatId) return true;
  return input.allowedScopes.some((allowed) => sameScope(allowed, scope));
};

const stableViewId = (value: unknown) =>
  ContextViewId.makeUnsafe(
    `context-view:${createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32)}`,
  );

export interface BuildContextViewInput {
  readonly workspace: ContextWorkspace;
  readonly records: ReadonlyArray<ContextRecord>;
  readonly compactionReceipts: ReadonlyArray<ContextCompactionReceipt>;
  readonly actorSeatId: string;
  readonly allowedScopes: ReadonlyArray<AuthorityScope>;
  readonly allowedProtectionClasses: ReadonlyArray<string>;
  readonly provider: string;
  readonly model: string;
  readonly providerLimitTokens: number | null;
  readonly maxRecords: number;
  readonly maxEstimatedTokens: number;
  readonly createdAt: string;
}

export interface BuiltContextView {
  readonly view: ContextView;
  readonly records: ReadonlyArray<ContextRecord>;
}

export function buildContextView(input: BuildContextViewInput): BuiltContextView {
  const allowedProtectionClasses = new Set(input.allowedProtectionClasses);
  const candidates = input.records.filter(
    (record) =>
      record.workspaceId === input.workspace.id &&
      record.status === "current" &&
      allowedProtectionClasses.has(record.protectionClass) &&
      visibleByScope({
        record,
        workspace: input.workspace,
        actorSeatId: input.actorSeatId,
        allowedScopes: input.allowedScopes,
      }),
  );
  const candidateIds = new Set(candidates.map((record) => record.id));
  const compactedSourceIds = new Set(
    input.compactionReceipts.flatMap((receipt) =>
      receipt.workspaceId === input.workspace.id && candidateIds.has(receipt.summaryRecordId)
        ? receipt.sourceRecordIds
        : [],
    ),
  );
  const ordered = candidates
    .filter((record) => !compactedSourceIds.has(record.id))
    .toSorted((left, right) => {
      const obligationOrder = Number(right.kind === "obligation") - Number(left.kind === "obligation");
      return obligationOrder || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
    });

  const selected: ContextRecord[] = [];
  let estimatedTokens = 0;
  const maxRecords = Math.max(1, Math.min(input.maxRecords, 512));
  const maxEstimatedTokens = Math.max(1, input.maxEstimatedTokens);
  for (const record of ordered) {
    if (selected.length >= maxRecords) break;
    const recordTokens = recordTokenEstimate(record);
    if (estimatedTokens + recordTokens > maxEstimatedTokens) continue;
    selected.push(record);
    estimatedTokens += recordTokens;
  }

  const recordIds = selected.map((record) => record.id);
  const evidenceRefs = [...new Set(selected.flatMap((record) => record.evidenceRefs))];
  const view: ContextView = {
    id: stableViewId({
      workspaceId: input.workspace.id,
      workspaceRevision: input.workspace.revision,
      actorSeatId: input.actorSeatId,
      recordIds,
      provider: input.provider,
      model: input.model,
    }),
    workspaceId: input.workspace.id,
    workspaceRevision: input.workspace.revision,
    actorSeatId: input.actorSeatId,
    recordIds,
    evidenceRefs,
    activeObligationRecordIds: selected
      .filter((record) => record.kind === "obligation")
      .map((record) => record.id),
    provider: input.provider,
    model: input.model,
    estimatedTokens,
    providerLimitTokens: input.providerLimitTokens,
    confidence: input.providerLimitTokens === null ? 0.65 : 0.9,
    createdAt: input.createdAt,
  };
  return { view, records: selected };
}

export function renderContextView(records: ReadonlyArray<ContextRecord>): string {
  if (records.length === 0) return "No scoped durable context records were selected.";
  return records
    .map((record) => {
      const content = record.inlineText ?? `[blob ${record.blob?.hash ?? "unavailable"}]`;
      return `- [${record.kind}] ${record.title}\n${content}`;
    })
    .join("\n\n");
}

export function planContextCompaction(input: {
  readonly workspace: ContextWorkspace;
  readonly records: ReadonlyArray<ContextRecord>;
  readonly sourceRecordIds: ReadonlyArray<ContextRecord["id"]>;
  readonly title: string;
  readonly summary: string;
  readonly createdBy: SupervisedActor;
  readonly protectionClass: string;
  readonly createdAt: string;
}): { readonly summaryRecord: ContextRecord; readonly receipt: ContextCompactionReceipt } {
  if (input.summary.length > 32_768) {
    throw new Error("Context compaction summary exceeds the durable text limit.");
  }
  const uniqueSourceIds = [...new Set(input.sourceRecordIds)];
  if (uniqueSourceIds.length === 0) throw new Error("Context compaction requires source records.");
  const sources = uniqueSourceIds.map((recordId) => {
    const record = input.records.find(
      (candidate) => candidate.id === recordId && candidate.workspaceId === input.workspace.id,
    );
    if (!record) throw new Error(`Context compaction source '${recordId}' is unavailable.`);
    return record;
  });
  if (sources.some((record) => !sameScope(record.scope, sources[0]!.scope))) {
    throw new Error("Context compaction cannot cross authority scopes.");
  }
  if (
    sources.some((record) => record.protectionClass !== sources[0]!.protectionClass) ||
    input.protectionClass !== sources[0]!.protectionClass
  ) {
    throw new Error("Context compaction cannot cross or weaken protection classes.");
  }
  const summaryRecord: ContextRecord = {
    id: ContextRecordId.makeUnsafe(`context-summary:${randomUUID()}`),
    workspaceId: input.workspace.id,
    kind: "summary",
    scope: sources[0]!.scope,
    title: input.title,
    inlineText: input.summary,
    blob: null,
    sourceEventIds: [...new Set(sources.flatMap((record) => record.sourceEventIds))],
    evidenceRefs: [...new Set(sources.flatMap((record) => record.evidenceRefs))],
    sourceRecordIds: uniqueSourceIds,
    provenance: { compaction: true, sourceCount: sources.length },
    protectionClass: input.protectionClass,
    estimatedTokens: Math.ceil(input.summary.length / 4),
    status: "current",
    contentRevision: 1,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
  return {
    summaryRecord,
    receipt: {
      id: ContextCompactionReceiptId.makeUnsafe(`context-compaction:${randomUUID()}`),
      workspaceId: input.workspace.id,
      summaryRecordId: summaryRecord.id,
      sourceRecordIds: uniqueSourceIds,
      evidenceRefs: summaryRecord.evidenceRefs,
      createdBy: input.createdBy,
      createdAt: input.createdAt,
    },
  };
}
