// FILE: SourceCommitRow.tsx
// Purpose: Responsive Source history row with graph, commit context, author, diff, and time.
// Layer: Source UI

import type { GitHistoryCommit } from "@veylen/contracts";
import type { CSSProperties } from "react";

import { PullRequestDiffStat } from "~/components/pullRequest/PullRequestDiffStat";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";

export function formatSourceCommitDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function chipTone(ref: string): "green" | "orange" | "purple" | "gray" {
  const lower = ref.toLowerCase();
  if (lower === "main" || lower === "master") return "green";
  if (lower.startsWith("origin/") || lower.startsWith("upstream/")) return "orange";
  if (lower.includes("stash")) return "gray";
  return "purple";
}

const CHIP_CLASS = {
  green: "border-emerald-500/40 bg-emerald-500/8 text-emerald-300",
  orange: "border-amber-500/45 bg-amber-500/8 text-amber-300",
  purple: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  gray: "border-border/60 bg-muted/35 text-muted-foreground",
} as const;

function BranchChip({ label }: { readonly label: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-48 shrink-0 items-center truncate rounded-full border px-1.5 py-px font-mono text-[10px] leading-4",
        CHIP_CLASS[chipTone(label)],
      )}
      title={label}
    >
      {label}
    </span>
  );
}

export function SourceCommitRow({
  commit,
  graphSvg,
  graphWidth,
  selected,
  onClick,
}: {
  readonly commit: GitHistoryCommit;
  readonly graphSvg: string;
  readonly graphWidth: number;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  const when = commit.authoredAt ? formatSourceCommitDate(commit.authoredAt) : "";
  const relative = commit.authoredAt
    ? formatRelativeTime(
        Number.isNaN(new Date(commit.authoredAt).getTime())
          ? new Date(0).toISOString()
          : new Date(commit.authoredAt).toISOString(),
      )
    : "";
  const rowStyle = { "--source-graph-width": `${graphWidth}px` } as CSSProperties;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "source-history-grid source-commit-row group relative min-h-14 w-full border-b border-border/25 px-3 text-left transition-colors",
        "hover:bg-[var(--color-background-elevated-secondary)]/55",
        selected && "bg-violet-500/10",
      )}
      style={rowStyle}
    >
      <span
        className="flex h-14 shrink-0 items-center overflow-hidden"
        dangerouslySetInnerHTML={{ __html: graphSvg }}
      />

      <span className="source-commit-main min-w-0 pr-2">
        <span className="source-commit-title truncate text-[13px] font-medium text-foreground">
          {commit.subject || "(no subject)"}
        </span>
        <span className="source-commit-meta mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden">
          {commit.refs.slice(0, 2).map((ref) => (
            <BranchChip key={ref} label={ref} />
          ))}
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground/65">
            {commit.shortSha}
          </span>
        </span>
      </span>

      <span className="source-commit-author truncate text-xs text-muted-foreground">
        {commit.authorName || "unknown"}
      </span>

      <span className="source-commit-changes">
        {commit.additions > 0 || commit.deletions > 0 ? (
          <PullRequestDiffStat
            additions={commit.additions}
            deletions={commit.deletions}
            tone="diff"
            className="text-[10px]"
          />
        ) : (
          <span className="text-[10px] text-muted-foreground/55">—</span>
        )}
      </span>

      <span
        className="source-commit-time text-right text-[11px] tabular-nums text-muted-foreground/70"
        title={when}
      >
        {relative}
      </span>
    </button>
  );
}
