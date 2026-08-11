import type { GitHistoryCommit, ProjectId } from "@veylen/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

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
import { SourceCommitGraph } from "~/components/source/SourceCommitGraph";
import "~/components/source/sourceCommitGraph.css";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { SearchInput } from "~/components/ui/search-input";
import { Skeleton } from "~/components/ui/skeleton";
import {
  useDesktopTopBarTrafficLightGutterClassName,
  useDesktopTopBarWindowControlsGutterClassName,
} from "~/hooks/useDesktopTopBarGutter";
import { GitBranchIcon, RefreshCwIcon } from "~/lib/icons";
import { gitBranchesQueryOptions, gitHistoryQueryOptions } from "~/lib/gitReactQuery";
import { cn } from "~/lib/utils";
import { useStore } from "~/store";

export interface SourceSearch {
  projectId?: ProjectId;
  sha?: string;
  q?: string;
}

export const Route = createFileRoute("/_chat/source/")({
  validateSearch: (raw): SourceSearch => ({
    ...(typeof raw.projectId === "string" && raw.projectId
      ? { projectId: raw.projectId as ProjectId }
      : {}),
    ...(typeof raw.sha === "string" && raw.sha.trim()
      ? { sha: raw.sha.trim().slice(0, 64) }
      : {}),
    ...(typeof raw.q === "string" && raw.q ? { q: raw.q.slice(0, 200) } : {}),
  }),
  component: SourceRouteView,
});

const HISTORY_LIMIT = 150;

function formatAuthoredAt(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const trafficLightGutter = useDesktopTopBarTrafficLightGutterClassName();
  const windowControlsGutter = useDesktopTopBarWindowControlsGutterClassName();
  const projects = useStore((store) => store.projects);

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
  const historyQuery = useQuery(gitHistoryQueryOptions(cwd, HISTORY_LIMIT));
  const branchesQuery = useQuery(gitBranchesQueryOptions(cwd));
  const [queryDraft, setQueryDraft] = useState(search.q ?? "");

  useEffect(() => {
    setQueryDraft(search.q ?? "");
  }, [search.q]);

  useEffect(() => {
    if (search.projectId || !activeProject) return;
    void navigate({
      search: (previous) => ({ ...previous, projectId: activeProject.id }),
      replace: true,
    });
  }, [activeProject, navigate, search.projectId]);

  const commits = historyQuery.data?.commits ?? [];
  const filteredCommits = useMemo(() => {
    const q = (search.q ?? "").trim().toLowerCase();
    if (!q) return commits;
    return commits.filter((commit) => {
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
  }, [commits, search.q]);

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

  const currentBranch = useMemo(() => {
    const branches = branchesQuery.data?.branches ?? [];
    return branches.find((branch) => branch.current && !branch.isRemote)?.name;
  }, [branchesQuery.data?.branches]);

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
    void navigate({
      search: () => ({ projectId }),
      replace: true,
    });
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
            <span className="truncate text-xs text-muted-foreground">{activeProject.name}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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
            onClick={() => void historyQuery.refetch()}
            aria-label="Refresh history"
          >
            <RefreshCwIcon className={cn("size-3.5", historyQuery.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className={cn("flex min-h-0 flex-1 flex-col", CHAT_MAIN_CONTENT_SURFACE_CLASS_NAME)}>
        {!activeProject ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No project selected</EmptyTitle>
                <EmptyDescription>
                  Add a local project to browse its git graph and commit history.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : historyQuery.isLoading ? (
          <div className="flex flex-1 flex-col gap-3 p-4">
            <Skeleton className="h-9 w-full rounded-full" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
            <Skeleton className="h-12 w-full rounded-xl" />
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
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Not a git repository</EmptyTitle>
                <EmptyDescription>
                  {activeProject.name} has no git metadata at {activeProject.cwd}.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : commits.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No commits yet</EmptyTitle>
                <EmptyDescription>This repository has no commit history to show.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
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
              placeholder="Search commits, authors, SHAs, branches…"
              className="h-9"
            />

            <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,0.65fr)]">
              <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/30">
                <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">History</span>
                    {historyQuery.data?.truncated ? " · truncated" : null}
                    <span className="ml-2 text-[10px] uppercase tracking-wide opacity-70">
                      commit-graph
                    </span>
                  </span>
                  <span>
                    {filteredCommits.length}
                    {filteredCommits.length !== commits.length ? ` of ${commits.length}` : ""}{" "}
                    commits
                  </span>
                </div>
                {filteredCommits.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No commits match this search.
                  </p>
                ) : (
                  <SourceCommitGraph
                    commits={filteredCommits}
                    {...(currentBranch ? { currentBranch } : {})}
                    onCommitSha={(sha) => selectCommit({ sha })}
                    className="p-2"
                  />
                )}
              </section>

              <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/30">
                <div className="flex items-center justify-between border-b border-border/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Commit</span>
                  {selectedCommit ? (
                    <span className="font-mono text-emerald-400/90">{selectedCommit.shortSha}</span>
                  ) : null}
                </div>
                {selectedCommit ? (
                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    <h2 className="text-sm font-semibold leading-snug">{selectedCommit.subject}</h2>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{selectedCommit.authorName}</span>
                      {selectedCommit.authoredAt ? (
                        <span>{formatAuthoredAt(selectedCommit.authoredAt)}</span>
                      ) : null}
                      <span className="font-mono">{selectedCommit.sha.slice(0, 12)}</span>
                    </div>
                    {selectedCommit.refs.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {selectedCommit.refs.map((ref) => (
                          <span
                            key={ref}
                            className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            <GitBranchIcon className="size-3" />
                            {ref}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {selectedCommit.parents.length > 0 ? (
                      <div className="mt-4">
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          Parents
                        </p>
                        <div className="flex flex-col gap-1">
                          {selectedCommit.parents.map((parent) => (
                            <button
                              key={parent}
                              type="button"
                              className="rounded-md bg-muted/40 px-2 py-1 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                              onClick={() => selectCommit({ sha: parent })}
                            >
                              {parent.slice(0, 12)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void navigator.clipboard?.writeText(selectedCommit.sha);
                        }}
                      >
                        Copy SHA
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void navigate({
                            to: "/pull-requests",
                            search: {
                              involvement: "all",
                              state: "open",
                              ...(activeProject ? { projectId: activeProject.id } : {}),
                            },
                          });
                        }}
                      >
                        Open pull requests
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                    Select a commit
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>
    </RouteInsetSurface>
  );
}
