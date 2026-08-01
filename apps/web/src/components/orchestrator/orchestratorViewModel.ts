import type {
  OrchestratorMessageEnvelope,
  OrchestratorOwnershipEdge,
  ThreadId,
} from "@synara/contracts";

export interface OwnershipTreeNode {
  readonly threadId: ThreadId;
  readonly edge: OrchestratorOwnershipEdge | null;
  readonly children: readonly OwnershipTreeNode[];
}

export interface ExchangeGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly OrchestratorMessageEnvelope[];
}

export function resolveSelectedOrchestratorThreadId(
  rootThreadId: ThreadId,
  requestedThreadId: string | null | undefined,
  ownershipEdges: readonly OrchestratorOwnershipEdge[],
): ThreadId {
  if (!requestedThreadId || requestedThreadId === rootThreadId) return rootThreadId;
  return ownershipEdges.some((edge) => edge.childThreadId === requestedThreadId)
    ? (requestedThreadId as ThreadId)
    : rootThreadId;
}

export function buildOwnershipTree(
  rootThreadId: ThreadId,
  ownershipEdges: readonly OrchestratorOwnershipEdge[],
): OwnershipTreeNode {
  const edgesByParent = new Map<ThreadId, OrchestratorOwnershipEdge[]>();
  for (const edge of ownershipEdges) {
    const siblings = edgesByParent.get(edge.parentThreadId) ?? [];
    siblings.push(edge);
    edgesByParent.set(edge.parentThreadId, siblings);
  }
  for (const siblings of edgesByParent.values()) {
    siblings.sort((left, right) => {
      const retiredOrder = Number(left.retiredAt !== null) - Number(right.retiredAt !== null);
      return (
        retiredOrder ||
        Date.parse(left.activeFrom) - Date.parse(right.activeFrom) ||
        left.childThreadId.localeCompare(right.childThreadId)
      );
    });
  }

  const visit = (
    threadId: ThreadId,
    edge: OrchestratorOwnershipEdge | null,
    ancestors: ReadonlySet<ThreadId>,
  ): OwnershipTreeNode => {
    if (ancestors.has(threadId)) return { threadId, edge, children: [] };
    const nextAncestors = new Set(ancestors).add(threadId);
    return {
      threadId,
      edge,
      children: (edgesByParent.get(threadId) ?? []).map((childEdge) =>
        visit(childEdge.childThreadId, childEdge, nextAncestors),
      ),
    };
  };

  return visit(rootThreadId, null, new Set());
}

export function groupOrchestratorExchanges(
  exchanges: readonly OrchestratorMessageEnvelope[],
): ExchangeGroup[] {
  const groups = new Map<string, OrchestratorMessageEnvelope[]>();
  for (const exchange of exchanges) {
    const id = exchange.assignmentId
      ? `assignment:${exchange.assignmentId}`
      : exchange.runId
        ? `run:${exchange.runId}`
        : exchange.correlationId
          ? `correlation:${exchange.correlationId}`
          : `message:${exchange.messageId}`;
    const items = groups.get(id) ?? [];
    items.push(exchange);
    groups.set(id, items);
  }

  return [...groups.entries()]
    .map(([id, items]) => ({
      id,
      label: id.replace(":", " "),
      items: items.toSorted(
        (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
      ),
    }))
    .toSorted((left, right) => {
      const leftTime = Date.parse(left.items.at(-1)?.createdAt ?? "");
      const rightTime = Date.parse(right.items.at(-1)?.createdAt ?? "");
      return rightTime - leftTime || left.id.localeCompare(right.id);
    });
}

export function threadLabel(labels: ReadonlyMap<ThreadId, string>, threadId: ThreadId): string {
  return labels.get(threadId) ?? threadId;
}
