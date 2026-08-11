import type { GitBranch } from "@veylen/contracts";

export function SourceBranchesView({ branches }: { readonly branches: readonly GitBranch[] }) {
  const local = branches.filter((branch) => !branch.isRemote);
  const remote = branches.filter((branch) => branch.isRemote);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <BranchSection title="Local branches" branches={local} />
      <BranchSection title="Remote branches" branches={remote} className="mt-7" />
    </div>
  );
}

function BranchSection({
  title,
  branches,
  className,
}: {
  readonly title: string;
  readonly branches: readonly GitBranch[];
  readonly className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center justify-between px-2">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/65">
          {title}
        </h2>
        <span className="text-[10px] tabular-nums text-muted-foreground/55">{branches.length}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/45">
        {branches.length > 0 ? (
          branches.map((branch) => (
            <div
              key={`${branch.isRemote ? "remote" : "local"}:${branch.name}`}
              className="flex min-h-11 items-center gap-2 border-b border-border/25 px-3 last:border-b-0"
            >
              <span
                className={
                  branch.current
                    ? "size-2 rounded-full bg-emerald-400"
                    : "size-2 rounded-full border border-muted-foreground/45"
                }
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85">
                {branch.name}
              </span>
              {branch.current ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
                  current
                </span>
              ) : null}
              {branch.isDefault ? (
                <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                  default
                </span>
              ) : null}
              {branch.worktreePath ? (
                <span
                  className="max-w-48 truncate text-[10px] text-muted-foreground/55"
                  title={branch.worktreePath}
                >
                  {branch.worktreePath}
                </span>
              ) : null}
            </div>
          ))
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No branches.</p>
        )}
      </div>
    </section>
  );
}
