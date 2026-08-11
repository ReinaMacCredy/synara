// FILE: SourceCommitGraph.tsx
// Purpose: Thin adapter around the `commit-graph` library for Source history.
// Layer: Source UI

import type { GitHistoryCommit } from "@veylen/contracts";
import { CommitGraph } from "commit-graph";
import { useMemo } from "react";

import { cn } from "~/lib/utils";

const GRAPH_STYLE = {
  commitSpacing: 42,
  branchSpacing: 16,
  nodeRadius: 3,
  branchColors: [
    "#39c5cf",
    "#ba68c8",
    "#8bc34a",
    "#ff9800",
    "#f44336",
    "#26c6da",
    "#7e57c2",
    "#66bb6a",
    "#42a5f5",
    "#ec407a",
  ] as string[],
};

function formatCommitDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toCommitGraphCommits(commits: readonly GitHistoryCommit[]) {
  return commits.map((commit) => ({
    sha: commit.sha,
    commit: {
      author: {
        name: commit.authorName || "unknown",
        date: commit.authoredAt || new Date(0).toISOString(),
      },
      message: commit.subject || "(no subject)",
    },
    parents: commit.parents.map((sha) => ({ sha })),
  }));
}

/** Newest-first refs decorations → branch head markers for the library. */
export function branchHeadsFromCommits(commits: readonly GitHistoryCommit[]) {
  const seen = new Set<string>();
  const heads: Array<{ name: string; commit: { sha: string } }> = [];
  for (const commit of commits) {
    for (const ref of commit.refs) {
      const name = ref.trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      heads.push({ name, commit: { sha: commit.sha } });
    }
  }
  return heads;
}

export function SourceCommitGraph({
  commits,
  currentBranch,
  className,
  onCommitSha,
}: {
  readonly commits: readonly GitHistoryCommit[];
  readonly currentBranch?: string;
  readonly className?: string;
  readonly onCommitSha?: (sha: string) => void;
}) {
  const graphCommits = useMemo(() => toCommitGraphCommits(commits), [commits]);
  const branchHeads = useMemo(() => branchHeadsFromCommits(commits), [commits]);

  return (
    <div className={cn("source-commit-graph min-h-0 flex-1 overflow-auto", className)}>
      <CommitGraph
        commits={graphCommits}
        branchHeads={branchHeads}
        graphStyle={GRAPH_STYLE}
        dateFormatFn={formatCommitDate}
        {...(currentBranch ? { currentBranch } : {})}
        onCommitClick={(node) => {
          onCommitSha?.(node.hash);
        }}
      />
    </div>
  );
}
