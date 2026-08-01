import { ThreadId, type ProviderKind, type RuntimeMode } from "@synara/contracts";
import { getDefaultModel } from "@synara/shared/model";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { getAppModelOptions, getCustomModelsByProvider, useAppSettings } from "../appSettings";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  dialogFieldLabelClassName,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useHandleNewOrchestrator } from "../hooks/useHandleNewOrchestrator";
import { useProviderStatusesForLocalConfig } from "../hooks/useProviderStatusesForLocalConfig";
import { orchestratorRootsQueryOptions, sortOrchestratorRoots } from "../lib/orchestratorRoots";
import { PROVIDER_OPTIONS } from "../session-logic";
import { useStore } from "../store";
import { createAllThreadsSelector } from "../storeSelectors";
import type { Project, Thread } from "../types";

export interface OrchestratorIndexSearch {
  readonly create?: boolean;
  readonly sourceThreadId?: string;
}

const controlClassName =
  "min-h-9 w-full rounded-md border border-[color:var(--color-border)] bg-[var(--color-background-control-opaque)] px-3 text-sm text-foreground outline-none focus:border-[color:var(--color-border-focus)]";

function CreateOrchestratorDialog(props: {
  readonly open: boolean;
  readonly projects: readonly Project[];
  readonly sourceThread: Thread | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { settings } = useAppSettings();
  const providerStatuses = useProviderStatusesForLocalConfig();
  const { createOrchestrator } = useHandleNewOrchestrator();
  const sourceProject = props.sourceThread
    ? (props.projects.find((project) => project.id === props.sourceThread?.projectId) ?? null)
    : null;
  const handoffSource = sourceProject?.kind === "project" ? props.sourceThread : null;
  const realProjects = useMemo(
    () => props.projects.filter((project) => project.kind === "project" && project.cwd.trim()),
    [props.projects],
  );
  const initialProjectId = handoffSource?.projectId ?? realProjects[0]?.id ?? null;
  const initialProvider =
    handoffSource?.modelSelection.provider ??
    sourceProject?.defaultModelSelection?.provider ??
    settings.defaultProvider;
  const [projectId, setProjectId] = useState(initialProjectId);
  const [provider, setProvider] = useState<ProviderKind>(initialProvider);
  const [model, setModel] = useState(
    handoffSource?.modelSelection.model ?? getDefaultModel(initialProvider) ?? "",
  );
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>(
    handoffSource?.runtimeMode ?? "approval-required",
  );
  const [title, setTitle] = useState(handoffSource ? `Orchestrator: ${handoffSource.title}` : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customModelsByProvider = getCustomModelsByProvider(settings);
  const modelOptions = getAppModelOptions(provider, customModelsByProvider[provider], model);
  const selectedProject = realProjects.find((project) => project.id === projectId) ?? null;
  const selectedProviderStatus = providerStatuses.find((status) => status.provider === provider);

  useEffect(() => {
    if (!props.open) return;
    const nextProjectId = handoffSource?.projectId ?? realProjects[0]?.id ?? null;
    const nextProvider = handoffSource?.modelSelection.provider ?? settings.defaultProvider;
    setProjectId(nextProjectId);
    setProvider(nextProvider);
    setModel(handoffSource?.modelSelection.model ?? getDefaultModel(nextProvider) ?? "");
    setRuntimeMode(handoffSource?.runtimeMode ?? "approval-required");
    setTitle(handoffSource ? `Orchestrator: ${handoffSource.title}` : "");
    setError(null);
  }, [handoffSource, props.open, realProjects, settings.defaultProvider]);

  const submit = async () => {
    if (!selectedProject || !title.trim() || !model.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createOrchestrator({
        project: selectedProject,
        title,
        provider,
        model,
        runtimeMode,
        sourceThread: handoffSource,
      });
      props.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to create the Orchestrator Root.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !busy && props.onOpenChange(open)}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {handoffSource ? "Create Orchestrator from thread" : "Create Orchestrator Root"}
          </DialogTitle>
          <DialogDescription>
            {handoffSource
              ? "A curated copy of completed user and assistant messages becomes the Root context. The source system instruction is not inherited or changed."
              : "Create an independent Root thread in a real Project workspace."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="grid gap-1.5">
              <span className={dialogFieldLabelClassName}>Title</span>
              <Input
                value={title}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className={dialogFieldLabelClassName}>Project workspace</span>
              <select
                className={controlClassName}
                value={projectId ?? ""}
                disabled={busy || handoffSource !== null}
                onChange={(event) => setProjectId(event.target.value as Project["id"])}
              >
                {realProjects.length === 0 ? <option value="">No Project workspace</option> : null}
                {realProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {project.cwd}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className={dialogFieldLabelClassName}>Provider</span>
                <select
                  className={controlClassName}
                  value={provider}
                  disabled={busy}
                  onChange={(event) => {
                    const nextProvider = event.target.value as ProviderKind;
                    setProvider(nextProvider);
                    setModel(getDefaultModel(nextProvider) ?? "");
                  }}
                >
                  {PROVIDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className={dialogFieldLabelClassName}>Model</span>
                <select
                  className={controlClassName}
                  value={model}
                  disabled={busy}
                  onChange={(event) => setModel(event.target.value)}
                >
                  {modelOptions.length === 0 ? <option value="">No model configured</option> : null}
                  {modelOptions.map((option) => (
                    <option key={option.slug} value={option.slug}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="grid gap-1.5">
              <span className={dialogFieldLabelClassName}>Runtime mode</span>
              <select
                className={controlClassName}
                value={runtimeMode}
                disabled={busy}
                onChange={(event) => setRuntimeMode(event.target.value as RuntimeMode)}
              >
                <option value="approval-required">Approval required</option>
                <option value="auto">Auto</option>
                <option value="full-access">Full access</option>
              </select>
            </label>
            {props.sourceThread && !handoffSource ? (
              <p className="text-sm text-warning">
                This thread is not inside a real Project, so it cannot be used as a handoff source.
              </p>
            ) : null}
            {selectedProviderStatus && !selectedProviderStatus.available ? (
              <p className="text-sm text-warning">
                {selectedProviderStatus.message ?? "This provider is not available on the server."}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              busy ||
              !selectedProject ||
              !title.trim() ||
              !model.trim() ||
              selectedProviderStatus?.available === false
            }
            onClick={() => void submit()}
          >
            {busy ? "Creating..." : "Create Root"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function OrchestratorIndexRouteView() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const projects = useStore((store) => store.projects);
  const selectAllThreads = useMemo(() => createAllThreadsSelector(), []);
  const threads = useStore(selectAllThreads);
  const [filter, setFilter] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(search.create === true);
  const rootsQuery = useQuery(orchestratorRootsQueryOptions({ includeArchived, limit: 100 }));
  const sourceThread = search.sourceThreadId
    ? (threads.find((thread) => thread.id === search.sourceThreadId) ?? null)
    : null;
  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread] as const)),
    [threads],
  );
  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );
  const normalizedFilter = filter.trim().toLowerCase();
  const roots = sortOrchestratorRoots(rootsQuery.data?.items ?? []).filter((root) => {
    if (!normalizedFilter) return true;
    const thread = threadById.get(root.rootThreadId);
    const project = projectById.get(root.projectId);
    return [
      thread?.title,
      project?.name,
      thread?.modelSelection.provider,
      thread?.modelSelection.model,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedFilter));
  });

  const closeDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open && (search.create || search.sourceThreadId)) {
      void navigate({ to: "/orchestrator", replace: true, search: {} });
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-6 sm:p-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Synara
            </p>
            <h1 className="font-heading text-3xl font-semibold">Orchestrator</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Independent Root threads coordinate provider-spanning children, Task Processes, and
              council runs.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>Create Root</Button>
        </header>

        <div className="flex flex-wrap gap-3">
          <Input
            className="min-w-56 flex-1"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by title, Project, provider, or model"
            aria-label="Filter Orchestrator Roots"
          />
          <label className="inline-flex items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            Archived
          </label>
        </div>

        <section className="grid gap-3" aria-label="Orchestrator Roots">
          {roots.map((root) => {
            const thread = threadById.get(root.rootThreadId);
            const project = projectById.get(root.projectId);
            return (
              <button
                key={root.rootThreadId}
                type="button"
                className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  void navigate({
                    to: "/orchestrator/$rootThreadId",
                    params: { rootThreadId: root.rootThreadId },
                  })
                }
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">{thread?.title ?? "Orchestrator Root"}</span>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                    {root.state}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{project?.name ?? root.projectId}</span>
                  {thread ? (
                    <span>
                      {thread.modelSelection.provider} · {thread.modelSelection.model}
                    </span>
                  ) : null}
                  <span>Protocol v{root.protocolVersion}</span>
                </div>
              </button>
            );
          })}
          {rootsQuery.isPending ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading Roots...</p>
          ) : null}
          {!rootsQuery.isPending && roots.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <p className="font-medium">No Orchestrator Roots found</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a clean Root or hand off an existing Project thread.
              </p>
            </div>
          ) : null}
          {rootsQuery.error ? (
            <p role="alert" className="text-sm text-destructive">
              {rootsQuery.error.message}
            </p>
          ) : null}
        </section>
      </div>

      <CreateOrchestratorDialog
        open={dialogOpen}
        projects={projects}
        sourceThread={sourceThread}
        onOpenChange={closeDialog}
      />
    </main>
  );
}

export const Route = createFileRoute("/_chat/orchestrator/")({
  validateSearch: (raw: Record<string, unknown>): OrchestratorIndexSearch => ({
    ...(raw.create === true || raw.create === "true" ? { create: true } : {}),
    ...(typeof raw.sourceThreadId === "string" && raw.sourceThreadId.length > 0
      ? { sourceThreadId: raw.sourceThreadId }
      : {}),
  }),
  component: OrchestratorIndexRouteView,
});
