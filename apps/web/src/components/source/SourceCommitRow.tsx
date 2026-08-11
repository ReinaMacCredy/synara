// FILE: SourceCommitRow.tsx
// Purpose: GitHub-style history row — graph lane, message + branch chips, author, SHA, date.
// Layer: Source UI

import type { GitHistoryCommit } from "@veylen/contracts";

import { PullRequestAvatar } from "~/components/pullRequest/PullRequestAvatar";
import { PullRequestDiffStat } from "~/components/pullRequest/PullRequestDiffStat";
import {
  PR_BODY_TEXT_CLASS_NAME,
  PR_FINE_TEXT_CLASS_NAME,
  PR_QUIET_INK_CLASS_NAME,
} from "~/components/pullRequest/pullRequestText";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";

/** GitHub Desktop-ish absolute time when recent, else short locale date. */
export function formatSourceCommitDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThatDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfThatDay.getTime()) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  if (dayDiff === 0) return `Today at ${time}`;
  if (dayDiff === 1) return `Yesterday at ${time}`;
  if (dayDiff > 1 && dayDiff < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: "short" })} at ${time}`;
  }
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function chipTone(ref: string, index: number): "green" | "orange" | "red" | "purple" | "gray" {
  const lower = ref.toLowerCase();
  if (lower === "main" || lower === "master") return "green";
  if (lower.startsWith("origin/") || lower.startsWith("upstream/")) return "orange";
  if (lower.includes("stash")) return "gray";
  if (index === 0) return "orange";
  if (index === 1) return "purple";
  return "red";
}

const CHIP_CLASS: Record<string, string> = {
  green:
    "border-emerald-500/45 bg-emerald-500/10 text-emerald-300",
  orange: "border-amber-500/50 bg-amber-500/10 text-amber-300",
  red: "border-red-500/45 bg-red-500/10 text-red-300",
  purple: "border-violet-500/45 bg-violet-500/12 text-violet-300",
  gray: "border-border/60 bg-muted/40 text-muted-foreground",
};

function BranchChip({ label, tone }: { label: string; tone: keyof typeof CHIP_CLASS }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[11rem] shrink-0 items-center truncate rounded-full border px-1.5 py-px font-mono text-[10.5px] leading-4",
        CHIP_CLASS[tone],
      )}
      title={label}
    >
      {label}
    </span>
  );
}

function MergeGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={cn("size-3 shrink-0 opacity-70", className)}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden
    >
      <circle cx="3" cy="3" r="1.5" />
      <circle cx="3" cy="9" r="1.5" />
      <circle cx="9" cy="3" r="1.5" />
      <path d="M3 4.5v3M9 4.5v1.2A2.3 2.3 0 0 1 6.7 8H4.5" strokeLinecap="round" />
    </svg>
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
  const isMerge = commit.parents.length > 1;
  const chips = commit.refs.slice(0, 3);
  const when = commit.authoredAt ? formatSourceCommitDate(commit.authoredAt) : "";
  const relative = commit.authoredAt
    ? formatRelativeTime(
        Number.isNaN(new Date(commit.authoredAt).getTime())
          ? new Date(0).toISOString()
          : new Date(commit.authoredAt).toISOString(),
      )
    : "";
  const actor = {
    login: commit.authorName.trim() || "unknown",
    name: commit.authorName.trim() || null,
    avatarUrl: null as string | null,
    url: null as string | null,
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "grid w-full items-center gap-x-2.5 border-b border-border/20 px-2 py-0 text-left transition-colors",
        "min-h-8 hover:bg-[var(--color-background-elevated-secondary)]/70",
        selected && "bg-[var(--color-background-elevated-secondary)]",
      )}
      style={{
        gridTemplateColumns: `${graphWidth}px minmax(0, 1fr) minmax(7.5rem, 9rem) 4.5rem minmax(6.5rem, 8rem)`,
      }}
    >
      <div
        className="flex h-8 shrink-0 items-center"
        style={{ width: graphWidth }}
        dangerouslySetInnerHTML={{ __html: graphSvg }}
      />

      <span className="flex min-w-0 items-center gap-1.5">
        {chips.map((ref, index) => (
          <BranchChip key={ref} label={ref} tone={chipTone(ref, index)} />
        ))}
        {isMerge ? <MergeGlyph className="text-muted-foreground" /> : null}
        <span
          className={cn(
            PR_BODY_TEXT_CLASS_NAME,
            "min-w-0 truncate font-medium",
            isMerge ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {commit.subject || "(no subject)"}
        </span>
      </span>

      <span
        className={cn(PR_FINE_TEXT_CLASS_NAME, PR_QUIET_INK_CLASS_NAME, "flex min-w-0 items-center gap-1.5")}
      >
        <PullRequestAvatar actor={actor} size="sm" className="shrink-0" />
        <span className="truncate">{commit.authorName || "unknown"}</span>
      </span>

      <span className={cn(PR_FINE_TEXT_CLASS_NAME, "font-mono text-muted-foreground tabular-nums")}>
        {commit.shortSha}
      </span>

      <span className="flex min-w-0 flex-col items-end gap-0.5">
        <span
          className={cn(PR_FINE_TEXT_CLASS_NAME, PR_QUIET_INK_CLASS_NAME, "truncate tabular-nums")}
          title={when}
        >
          {when || relative}
        </span>
        {commit.additions > 0 || commit.deletions > 0 ? (
          <PullRequestDiffStat
            additions={commit.additions}
            deletions={commit.deletions}
            tone="diff"
            className="text-[10px]"
          />
        ) : null}
      </span>
    </button>
  );
}
