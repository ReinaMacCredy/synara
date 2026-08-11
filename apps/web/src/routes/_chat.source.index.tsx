import type { GitHistoryCommit, ProjectId } from "@veylen/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import {
  CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
  CHAT_SURFACE_HEADER_HEIGHT_CLASS,
  CHAT_SURFACE_HEADER_PADDING_X_CLASS,
} from "~/components/chat/chatHeaderControls";
import {
  CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME,
  CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME,
} from "~/components/chat/composerPickerStyles";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { SidebarHeaderNavigationControls } from "~/components/SidebarHeaderNavigationControls";
import { SourceBranchesView } from "~/components/source/SourceBranchesView";
import { SourceCommitGraph } from "~/components/source/SourceCommitGraph";
import { SourceCommitInspector } from "~/components/source/SourceCommitInspector";
import { SourceWorkingTreeView } from "~/components/source/SourceWorkingTreeView";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { SearchInput } from "~/components/ui/search-input";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { copyTextToClipboard } from "~/hooks/useCopyToClipboard";
import { appendComposerPromptText } from "~/lib/chatReferences";
import { LoaderCircleIcon, RefreshCwIcon } from "~/lib/icons";
import {
  gitBranchesQueryOptions,
  gitHistoryQueryOptions,
  gitStatusQueryOptions,
} from "~/lib/gitReactQuery";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";

export interface SourceSearch {
  projectId?: ProjectId;
  sha?: string;
  q?: string;
}

type SourceView = "history" | "branches" | "workingTree";

export const Route = createFileRoute("/_chat/source/")({
  validateSearch: (raw): SourceSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.sha === "string" && raw.sha.trim() ? { sha: raw.sha.trim().slice(0, 64) } : {}),
    ...(typeof raw.q === "string" && raw.q ? { q: raw.q.slice(0, 200) } : {}),
  }),
  component: SourceRouteView,
});

const HISTORY_PAGE_SIZE = 250;
const HISTORY_MAX = 500;

function historyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null) {
    const record = error as { message?: unknown; cause?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.cause === "string" && record.cause.trim()) return record.cause;
  }
  if (typeof error === "string" && error.trim()) return error;
  return "Git history request failed.";
}

function SourceRouteView() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { handleNewThread } = useHandleNewThread();
  const trafficLightGutter = useDesktopTopBarTrafficLightGutterClassName();
  const windowControlsGutter = useDesktopTopBarWindowControlsGutterClassName();
  const projects = useStore((store) => store.projects);
  const [sourceView, setSourceView] = useState<SourceView>("history");
  const [referenceFilter, setReferenceFilter] = useState("all");
  const [openingCommitSha, setOpeningCommitSha] = useState<string | null>(null);

  const repositoryProjects = useMemo(
    () =>
      projects
        .filter((project) => project.kind === "project" && Boolean(project.cwd))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    [projects],
  );

  const activeProject = useMemo(() => {
    if (search.projectId) {
      return repositoryProjects.find((project) => project.id === search.projectId) ?? null;
    }
    return repositoryProjects[0] ?? null;
  }, [repositoryProjects, search.projectId]);

  const cwd = activeProject?.cwd ?? null;
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE_SIZE);
  const historyQuery = useQuery({
    ...gitHistoryQueryOptions(cwd, historyLimit),
    placeholderData: (previous) => previous,
  });
  const branchesQuery = useQuery(gitBranchesQueryOptions(cwd));
  const statusQuery = useQuery(gitStatusQueryOptions(cwd));
  const [queryDraft, setQueryDraft] = useState(search.q ?? "");

  useEffect(() => {
    setQueryDraft(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    setHistoryLimit(HISTORY_PAGE_SIZE);
    setReferenceFilter("all");
  }, [cwd]);

  useEffect(() => {
    if (search.projectId || !activeProject) return;
    void navigate({
      search: (previous) => ({ ...previous, projectId: activeProject.id }),
      replace: true,
    });
  }, [activeProject, navigate, search.projectId]);

  const hasMoreHistory = historyQuery.data?.truncated === true && historyLimit < HISTORY_MAX;
  const isLoadingMore =
    historyQuery.isFetching &&
    !historyQuery.isPending &&
    (historyQuery.data?.commits.length ?? 0) > 0;

  const loadMoreHistory = useCallback(() => {
    if (!hasMoreHistory || historyQuery.isFetching) return;
    setHistoryLimit((current) => Math.min(current + HISTORY_PAGE_SIZE, HISTORY_MAX));
  }, [hasMoreHistory, historyQuery.isFetching]);

  const commits = historyQuery.data?.commits ?? [];
  const referenceOptions = useMemo(
    () => [...new Set(commits.flatMap((commit) => commit.refs))].toSorted(),
    [commits],
  );
  const filteredCommits = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    return commits.filter((commit) => {
      const matchesReference = referenceFilter === "all" || commit.refs.includes(referenceFilter);
      if (!matchesReference) return false;
      if (!q) return true;
      const haystack = [
        commit.subject,
        commit.authorName,
        commit.shortSha,
        commit.sha,
        ...commit.refs,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [commits, referenceFilter, search.q]);

  const selectedCommit = useMemo(() => {
    if (search.sha) {
      return (
        filteredCommits.find((commit) => commit.sha.startsWith(search.sha!)) ??
        filteredCommits[0] ??
        null
      );
    }
    return filteredCommits[0] ?? null;
  }, [filteredCommits, search.sha]);

  const branches = branchesQuery.data?.branches ?? [];
  const currentBranch =
    statusQuery.data?.branch ?? branches.find((branch) => branch.current && !branch.isRemote)?.name;
  const workingTreeFileCount = statusQuery.data?.workingTree.files.length ?? 0;

  const selectCommit = (commit: GitHistoryCommit | { sha: string }) => {
    void navigate({
      search: (previous) => ({
        ...previous,
        sha: commit.sha.slice(0, 12),
        ...(activeProject ? { projectId: activeProject.id } : {}),
      }),
      replace: true,
    });
  };

  const setProjectId = (projectId: ProjectId) => {
    void navigate({ search: () => ({ projectId }), replace: true });
  };

  const applySearch = (value: string) => {
    const next = value.trim();
    void navigate({
      search: (previous) => {
        const { q: _ignored, ...rest } = previous;
        return {
          ...rest,
          ...(next ? { q: next } : {}),
          ...(activeProject ? { projectId: activeProject.id } : {}),
        };
      },
      replace: true,
    });
  };

  const refreshSource = () => {
    void Promise.all([historyQuery.refetch(), branchesQuery.refetch(), statusQuery.refetch()]);
  };

  const copyCommitSha = (sha: string) => {
    void copyTextToClipboard(sha).then(
      () => toastManager.add({ type: "success", title: "Commit SHA copied" }),
      (error: unknown) =>
        toastManager.add({
          type: "error",
          title: "Could not copy commit SHA",
          description: error instanceof Error ? error.message : "Clipboard unavailable.",
        }),
    );
  };

  const openCommitThread = (commit: GitHistoryCommit) => {
    if (!activeProject || openingCommitSha) return;
    setOpeningCommitSha(commit.sha);
    const prompt = [
      `Review commit ${commit.sha} (${commit.subject || "no subject"}) in this repository.`,
      "Explain its intent, inspect the diff for correctness and regressions, and suggest any follow-up work.",
    ].join(" ");
    void Promise.resolve(
      handleNewThread(activeProject.id, {
        ...(currentBranch ? { branch: currentBranch } : {}),
        fresh: true,
      }),
    )
      .then((threadId) => {
        if (!threadId) throw new Error("Could not create a draft thread for this commit.");
        appendComposerPromptText(threadId, prompt);
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not open commit in a thread",
          description: error instanceof Error ? error.message : "Thread creation failed.",
        });
      })
      .finally(() => setOpeningCommitSha(null));
  };

  const statusLabel = useMemo(() => {
    if (!statusQuery.data) return currentBranch ?? "Repository";
    const cleanliness = statusQuery.data.hasWorkingTreeChanges ? "changes" : "clean";
    const sync =
      statusQuery.data.aheadCount > 0 || statusQuery.data.behindCount > 0
        ? `↑${statusQuery.data.aheadCount} ↓${statusQuery.data.behindCount}`
        : "synced";
    return [statusQuery.data.branch ?? currentBranch ?? "detached", cleanliness, sync].join(" · ");
  }, [currentBranch, statusQuery.data]);

  return (
    <RouteInsetSurface className={CHAT_MAIN_VIEWPORT_SHELL_CLASS_NAME}>
      <div
        className={cn(
          "flex shrink-0 items-center justify-between gap-3",
          CHAT_SURFACE_HEADER_HEIGHT_CLASS,
          CHAT_SURFACE_HEADER_PADDING_X_CLASS,
          CHAT_SURFACE_HEADER_DIVIDER_CLASS_NAME,
          trafficLightGutter,
          windowControlsGutter,
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <SidebarHeaderNavigationControls />
          <h1 className="truncate font-heading text-sm font-medium">Source</h1>
          {activeProject ? (
            <span className="truncate text-xs text-muted-foreground">/ {activeProject.name}</span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {activeProject ? (
            <span className="hidden max-w-64 truncate text-[11px] text-muted-foreground sm:block">
              <span
                className={cn(
                  "mr-2 inline-block size-1.5 rounded-full",
                  statusQuery.data?.hasWorkingTreeChanges ? "bg-amber-400" : "bg-emerald-400",
                )}
              />
              {statusLabel}
            </span>
          ) : null}
          {repositoryProjects.length > 1 ? (
            <select
              className="h-8 max-w-[200px] rounded-md border border-border/60 bg-background px-2 text-xs"
              value={activeProject?.id ?? ""}
              onChange={(event) => {
                const next = event.target.value as ProjectId;
                if (next) setProjectId(next);
              }}
              aria-label="Project"
            >
              {repositoryProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!cwd || historyQuery.isFetching}
            onClick={refreshSource}
            aria-label="Refresh source"
          >
            <RefreshCwIcon className={cn("size-3.5", historyQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col", CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}>
        {!activeProject ? (
          <CenteredEmpty
            title="No project selected"
            description="Add a local project to browse its source history."
          />
        ) : historyQuery.isLoading ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
            <Skeleton className="h-14 w-full rounded-md" />
          </div>
        ) : historyQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
            <PanelStateMessage fill="flex">
              <div className="space-y-2">
                <p className="font-medium text-foreground">Could not load history</p>
                <p>{historyErrorMessage(historyQuery.error)}</p>
              </div>
            </PanelStateMessage>
            <Button type="button" size="sm" onClick={() => void historyQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : historyQuery.data && !historyQuery.data.isRepo ? (
          <CenteredEmpty
            title="Not a git repository"
            description={`${activeProject.name} has no git metadata at ${activeProject.cwd}.`}
          />
        ) : commits.length === 0 ? (
          <CenteredEmpty
            title="No commits yet"
            description="This repository has no commit history to show."
          />
        ) : (
          <>
            <nav
              className="flex h-12 shrink-0 items-end gap-6 border-b border-border/45 px-5"
              aria-label="Source sections"
            >
              <SourceTab active={sourceView === "history"} onClick={() => setSourceView("history")}>
                History{" "}
                <span className="ml-1 text-[10px] text-muted-foreground/55">{commits.length}</span>
              </SourceTab>
              <SourceTab
                active={sourceView === "branches"}
                onClick={() => setSourceView("branches")}
              >
                Branches{" "}
                <span className="ml-1 text-[10px] text-muted-foreground/55">{branches.length}</span>
              </SourceTab>
              <SourceTab
                active={sourceView === "workingTree"}
                onClick={() => setSourceView("workingTree")}
              >
                Working tree{" "}
                <span className="ml-1 text-[10px] text-muted-foreground/55">
                  {workingTreeFileCount}
                </span>
              </SourceTab>
            </nav>

            {sourceView === "history" ? (
              <>
                <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border/35 px-4 py-3 sm:grid-cols-[minmax(260px,1fr)_minmax(140px,210px)]">
                  <SearchInput
                    value={queryDraft}
                    onChange={(event) => setQueryDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        applySearch(queryDraft);
                      }
                    }}
                    onBlur={() => {
                      if (queryDraft !== (search.q ?? "")) applySearch(queryDraft);
                    }}
                    placeholder="Search message, branch, author, or SHA"
                    className="h-9"
                  />
                  <select
                    value={referenceFilter}
                    onChange={(event) => setReferenceFilter(event.target.value)}
                    className="h-9 min-w-0 rounded-md border border-border/55 bg-background px-2.5 text-xs text-muted-foreground"
                    aria-label="Filter by reference"
                  >
                    <option value="all">All refs</option>
                    {referenceOptions.map((ref) => (
                      <option key={ref} value={ref}>
                        {ref}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
                  <section className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/35">
                    {filteredCommits.length === 0 ? (
                      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
                        No commits match these filters.
                      </p>
                    ) : (
                      <SourceCommitGraph
                        commits={filteredCommits}
                        selectedSha={selectedCommit?.sha ?? search.sha ?? null}
                        hasMore={
                          hasMoreHistory && !(search.q ?? "").trim() && referenceFilter === "all"
                        }
                        isLoadingMore={
                          isLoadingMore && !(search.q ?? "").trim() && referenceFilter === "all"
                        }
                        onLoadMore={loadMoreHistory}
                        onCommitSha={(sha) => selectCommit({ sha })}
                      />
                    )}
                  </section>
                  <SourceCommitInspector
                    commit={selectedCommit}
                    openingThread={openingCommitSha === selectedCommit?.sha}
                    onCopySha={copyCommitSha}
                    onOpenThread={openCommitThread}
                    onSelectParent={(sha) => selectCommit({ sha })}
                  />
                </div>
              </>
            ) : sourceView === "branches" ? (
              branchesQuery.isLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <SourceBranchesView branches={branches} />
              )
            ) : (
              <SourceWorkingTreeView status={statusQuery.data} />
            )}
          </>
        )}
      </div>
    </RouteInsetSurface>
  );
}

function SourceTab({
  active,
  children,
  onClick,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-12 border-b-2 border-transparent text-xs text-muted-foreground transition-colors hover:text-foreground",
        active && "border-violet-400 font-medium text-foreground",
      )}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CenteredEmpty({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
