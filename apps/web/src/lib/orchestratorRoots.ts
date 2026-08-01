import {
  type ArtifactId,
  ThreadId,
  type ListOrchestratorRootsInput,
  type ListOrchestratorRootsResult,
  type OrchestratorRoot,
} from "@synara/contracts";

import { readNativeApi } from "../nativeApi";

export const orchestratorQueryKeys = {
  all: ["orchestrator"] as const,
  roots: (input: ListOrchestratorRootsInput = {}) =>
    [...orchestratorQueryKeys.all, "roots", input] as const,
  root: (rootThreadId: ThreadId) => [...orchestratorQueryKeys.all, "root", rootThreadId] as const,
  exchanges: (rootThreadId: ThreadId) =>
    [...orchestratorQueryKeys.root(rootThreadId), "exchanges"] as const,
  artifacts: (rootThreadId: ThreadId) =>
    [...orchestratorQueryKeys.root(rootThreadId), "artifacts"] as const,
  artifact: (rootThreadId: ThreadId, artifactId: ArtifactId) =>
    [...orchestratorQueryKeys.artifacts(rootThreadId), artifactId] as const,
  audit: (rootThreadId: ThreadId) =>
    [...orchestratorQueryKeys.root(rootThreadId), "audit"] as const,
};

export function orchestratorRootsQueryOptions(input: ListOrchestratorRootsInput = {}) {
  const normalized = { includeArchived: false, limit: 100, ...input };
  return {
    queryKey: orchestratorQueryKeys.roots(normalized),
    queryFn: async (): Promise<ListOrchestratorRootsResult> => {
      const api = readNativeApi();
      if (!api) throw new Error("The Synara server is unavailable.");
      return api.orchestration.listOrchestratorRoots(normalized);
    },
    staleTime: 10_000,
  };
}

export function sortOrchestratorRoots(roots: readonly OrchestratorRoot[]): OrchestratorRoot[] {
  return roots.toSorted((left, right) => {
    const leftTime = Date.parse(left.archivedAt ?? left.createdAt);
    const rightTime = Date.parse(right.archivedAt ?? right.createdAt);
    return rightTime - leftTime || right.rootThreadId.localeCompare(left.rootThreadId);
  });
}

export function collectOrchestratorThreadIds(
  roots: readonly Pick<OrchestratorRoot, "rootThreadId">[],
  threads: readonly { readonly id: ThreadId; readonly parentThreadId?: ThreadId | null }[],
): ReadonlySet<ThreadId> {
  const ids = new Set<ThreadId>(roots.map((root) => root.rootThreadId));
  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of threads) {
      if (thread.parentThreadId && ids.has(thread.parentThreadId) && !ids.has(thread.id)) {
        ids.add(thread.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function partitionThreadsByOrchestratorMembership<T extends { readonly id: ThreadId }>(
  threads: readonly T[],
  orchestratorThreadIds: ReadonlySet<ThreadId>,
): { readonly ordinaryThreads: T[]; readonly orchestratorThreads: T[] } {
  const ordinaryThreads: T[] = [];
  const orchestratorThreads: T[] = [];
  for (const thread of threads) {
    (orchestratorThreadIds.has(thread.id) ? orchestratorThreads : ordinaryThreads).push(thread);
  }
  return { ordinaryThreads, orchestratorThreads };
}
