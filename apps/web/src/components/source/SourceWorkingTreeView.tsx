import type { GitStatusResult } from "@veylen/contracts";

export function SourceWorkingTreeView({
  status,
}: {
  readonly status: GitStatusResult | undefined;
}) {
  const files = status?.workingTree.files ?? [];
  if (!status || files.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="text-center">
          <span className="mx-auto mb-3 block size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.08)]" />
          <p className="text-sm font-medium text-foreground">Working tree is clean</p>
          <p className="mt-1 text-xs text-muted-foreground">There are no local file changes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <div className="mb-3 flex items-center gap-3 px-2 text-xs text-muted-foreground">
        <span>{files.length} files</span>
        <span className="text-emerald-400">+{status.workingTree.insertions}</span>
        <span className="text-red-400">−{status.workingTree.deletions}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/45">
        {files.map((file) => (
          <div
            key={file.path}
            className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/25 px-3 font-mono text-xs last:border-b-0"
          >
            <span className="truncate text-foreground/80" title={file.path}>
              {file.path}
            </span>
            <span className="tabular-nums">
              <span className="text-emerald-400">+{file.insertions}</span>{" "}
              <span className="text-red-400">−{file.deletions}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
