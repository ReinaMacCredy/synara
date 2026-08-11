// FILE: SourceCommitGraph.tsx
// Purpose: GitHub-style Source history — custom lane SVG + row list (no third-party graph UI).
// Layer: Source UI

import type { GitHistoryCommit } from "@veylen/contracts";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from "react";

import {
  assignGitGraphLanes,
  gitGraphSvgWidth,
  maxGitGraphLane,
  renderGitGraphLaneSvg,
} from "~/components/source/gitGraphLanes";
import { SourceCommitRow } from "~/components/source/SourceCommitRow";
import { LoaderCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import "./sourceCommitGraph.css";

const ROW_HEIGHT = 56;

function SourceHistoryLoadingFooter() {
  return (
    <div
      className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
      <span>Loading ...</span>
    </div>
  );
}

export function SourceCommitGraph({
  commits,
  selectedSha,
  className,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onCommitSha,
}: {
  readonly commits: readonly GitHistoryCommit[];
  readonly projectName?: string;
  readonly currentBranch?: string;
  readonly selectedSha?: string | null;
  readonly className?: string;
  readonly hasMore?: boolean;
  readonly isLoadingMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly onCommitSha?: (sha: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const laneRows = useMemo(
    () =>
      assignGitGraphLanes(commits.map((commit) => ({ sha: commit.sha, parents: commit.parents }))),
    [commits],
  );
  const laneBySha = useMemo(() => new Map(laneRows.map((row) => [row.sha, row])), [laneRows]);
  const maxLane = useMemo(() => maxGitGraphLane(laneRows), [laneRows]);
  const graphWidth = useMemo(() => Math.min(gitGraphSvgWidth(maxLane, 10, 12), 90), [maxLane]);

  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore) return;
    onLoadMore?.();
  }, [hasMore, isLoadingMore, onLoadMore]);

  useEffect(() => {
    if (!onLoadMore || !hasMore) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: "120px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, onLoadMore, commits.length]);

  return (
    <div
      ref={scrollRef}
      className={cn("source-history-container min-h-0 flex-1 overflow-auto", className)}
    >
      <div
        className="source-history-grid sticky top-0 z-[1] min-h-9 border-b border-border/40 bg-background/95 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65 backdrop-blur-sm"
        style={{ "--source-graph-width": `${graphWidth}px` } as CSSProperties}
      >
        <span>Graph</span>
        <span>Commit</span>
        <span>Author</span>
        <span>Changes</span>
        <span className="text-right">When</span>
      </div>

      {commits.map((commit) => {
        const lane = laneBySha.get(commit.sha);
        const selected =
          selectedSha != null && (commit.sha === selectedSha || commit.sha.startsWith(selectedSha));
        const graphSvg = lane
          ? renderGitGraphLaneSvg({
              row: lane,
              maxLane,
              rowHeight: ROW_HEIGHT,
              width: graphWidth,
              padX: 10,
              gap: 12,
              nodeRadius: 3.4,
              strokeWidth: 2,
            })
          : "";

        return (
          <SourceCommitRow
            key={commit.sha}
            commit={commit}
            graphSvg={graphSvg}
            graphWidth={graphWidth}
            selected={selected}
            onClick={() => onCommitSha?.(commit.sha)}
          />
        );
      })}

      {hasMore || isLoadingMore ? (
        <div ref={sentinelRef}>
          {isLoadingMore ? <SourceHistoryLoadingFooter /> : <div className="h-8" aria-hidden />}
        </div>
      ) : null}
    </div>
  );
}
