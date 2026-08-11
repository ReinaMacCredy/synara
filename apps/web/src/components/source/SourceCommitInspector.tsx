import type { GitHistoryCommit } from "@veylen/contracts";

import { Button } from "~/components/ui/button";
import { LoaderCircleIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { formatSourceCommitDate } from "./SourceCommitRow";

export function SourceCommitInspector({
  commit,
  openingThread,
  onCopySha,
  onOpenThread,
  onSelectParent,
}: {
  readonly commit: GitHistoryCommit | null;
  readonly openingThread: boolean;
  readonly onCopySha: (sha: string) => void;
  readonly onOpenThread: (commit: GitHistoryCommit) => void;
  readonly onSelectParent: (sha: string) => void;
}) {
  if (!commit) {
    return (
      <aside className="flex min-h-0 items-center justify-center bg-background/35 p-6 text-sm text-muted-foreground">
        Select a commit
      </aside>
    );
  }

  const files = commit.files ?? [];

  return (
    <aside className="min-h-0 overflow-auto bg-background/35" aria-label="Selected commit details">
      <div className="p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/65">
          Selected commit
        </p>
        <h2 className="mt-2.5 text-[17px] font-semibold leading-snug tracking-[-0.015em]">
          {commit.subject || "(no subject)"}
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="grid size-6 place-items-center rounded-full bg-muted/60 text-[10px] font-semibold text-foreground/80">
            {(commit.authorName.trim()[0] ?? "?").toUpperCase()}
          </span>
          <span>{commit.authorName || "unknown"}</span>
          {commit.authoredAt ? <span>· {formatSourceCommitDate(commit.authoredAt)}</span> : null}
        </div>

        <div className="mt-4 rounded-md border border-border/45 bg-muted/15 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {commit.sha}
        </div>

        {commit.refs.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {commit.refs.map((ref) => (
              <span
                key={ref}
                className="max-w-full truncate rounded-full border border-violet-500/35 bg-violet-500/8 px-2 py-0.5 font-mono text-[10px] text-violet-300"
                title={ref}
              >
                {ref}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Button
            type="button"
            size="sm"
            className="bg-violet-400 text-violet-950 hover:bg-violet-300"
            disabled={openingThread}
            onClick={() => onOpenThread(commit)}
          >
            {openingThread ? <LoaderCircleIcon className="size-3.5 animate-spin" /> : null}
            Open in thread
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => onCopySha(commit.sha)}>
            Copy SHA
          </Button>
        </div>

        <section className="mt-7">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65">
            Change summary
          </h3>
          <div className="mt-2.5 grid grid-cols-3 overflow-hidden rounded-lg border border-border/45 bg-border/45">
            <SummaryCell value={files.length > 0 ? String(files.length) : "—"} label="files" />
            <SummaryCell value={`+${commit.additions}`} label="added" tone="add" />
            <SummaryCell value={`−${commit.deletions}`} label="removed" tone="delete" />
          </div>
        </section>

        {files.length > 0 ? (
          <section className="mt-7">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65">
              Changed files
            </h3>
            <div className="mt-2 space-y-0.5">
              {files.map((file) => (
                <div
                  key={file.path}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[10px] hover:bg-muted/25"
                >
                  <span className="truncate text-foreground/70" title={file.path}>
                    {file.path}
                  </span>
                  <span className="tabular-nums">
                    <span className="text-emerald-400">+{file.insertions}</span>{" "}
                    <span className="text-red-400">−{file.deletions}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {commit.parents.length > 0 ? (
          <section className="mt-7">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65">
              Parents
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {commit.parents.map((parent) => (
                <button
                  key={parent}
                  type="button"
                  className="rounded-md bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                  onClick={() => onSelectParent(parent)}
                >
                  {parent.slice(0, 12)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-7 border-l-2 border-violet-400 bg-violet-500/8 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          Open this commit in a thread to explain the change, review its intent, or continue work
          from this point in history.
        </section>
      </div>
    </aside>
  );
}

function SummaryCell({
  value,
  label,
  tone,
}: {
  readonly value: string;
  readonly label: string;
  readonly tone?: "add" | "delete";
}) {
  return (
    <div className="bg-background/80 px-3 py-2.5">
      <strong
        className={cn(
          "block text-sm font-semibold",
          tone === "add" && "text-emerald-400",
          tone === "delete" && "text-red-400",
        )}
      >
        {value}
      </strong>
      <span className="text-[10px] text-muted-foreground/65">{label}</span>
    </div>
  );
}
