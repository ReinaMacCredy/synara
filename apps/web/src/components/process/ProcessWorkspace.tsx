import {
  ProjectId,
  ProjectTaskId,
  TaskProcessId,
  TaskThreadBindingId,
  type ProjectTaskLifecycle,
  type ProjectTaskRisk,
  type TaskProcessCommand,
  type TaskProcessGraphProjection,
} from "@veylen/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { RouteInsetSurface } from "~/components/RouteInsetSurface";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { ComposerPickerSelectPopup } from "~/components/chat/ComposerPickerMenuPopup";
import { toastManager } from "~/components/ui/toast";
import {
  sessionProgressQueryOptions,
  taskProcessGraphQueryOptions,
  taskProcessQueryKeys,
  taskProcessesQueryOptions,
} from "~/lib/serverReactQuery";
import { newCommandId } from "~/lib/utils";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createAllThreadsSelector } from "~/storeSelectors";
import { resolveTaskProcessNavigationTarget } from "~/lib/taskProcessNavigation";
import {
  DISCLOSURE_CLEANUP_BUFFER_MS,
  DISCLOSURE_TRANSITION_MS,
  disclosureWidthClassName,
} from "~/lib/disclosureMotion";
import { useTaskProcessStore, type TaskProcessFilter } from "~/taskProcessStore";

import { deriveProcessBoardLane, ProcessBoard } from "./ProcessBoard";
import { ProcessGraph } from "./ProcessGraph";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

export interface ProcessAuthority {
  readonly mode: "project";
  readonly canEditGraph: boolean;
  readonly canCreateProcess: boolean;
  readonly canPauseProcess: boolean;
  readonly canCancelOrReopenTask: boolean;
}

export function resolveProcessAuthority(
  graph: Pick<TaskProcessGraphProjection, "process">,
): ProcessAuthority {
  const isUserOwned = graph.process.owner.kind === "user";
  const canEditGraph =
    isUserOwned && (graph.process.state === "active" || graph.process.state === "paused");
  return {
    mode: "project",
    canEditGraph,
    canCreateProcess: isUserOwned,
    canPauseProcess: graph.process.state === "active" || graph.process.state === "paused",
    canCancelOrReopenTask: graph.process.state === "active" || graph.process.state === "paused",
  };
}

function taskOrder(graph: TaskProcessGraphProjection) {
  return graph.tasks.toSorted((left, right) =>
    left.task.orderKey.localeCompare(right.task.orderKey),
  );
}

export function TaskDetailTransitionShell(props: {
  readonly open: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div
      className={disclosureWidthClassName(
        props.open,
        "w-[min(28rem,42vw)] max-lg:w-[min(28rem,100%)]",
        "relative shrink-0 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-20 max-lg:shadow-xl",
      )}
      aria-hidden={!props.open}
      inert={!props.open}
      data-task-detail-shell
    >
      {props.children}
    </div>
  );
}

export function ProcessWorkspace(props: { readonly processId: TaskProcessId }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const graphQuery = useQuery(taskProcessGraphQueryOptions(props.processId));
  const graph = graphQuery.data?.graph ?? null;
  const projectId = graph?.process.projectId ?? ProjectId.makeUnsafe("process-project-pending");
  const processListQuery = useQuery(
    taskProcessesQueryOptions({ projectId, includeArchived: true, enabled: graph !== null }),
  );
  const allThreads = useStore(useMemo(() => createAllThreadsSelector(), []));
  const threadOptions = useMemo(
    () =>
      graph
        ? allThreads
            .filter((thread) => thread.projectId === graph.process.projectId)
            .map((thread) => ({ id: thread.id, title: thread.title }))
        : [],
    [allThreads, graph],
  );
  const view = useTaskProcessStore((state) => state.byProcessId[props.processId]?.view ?? "board");
  const filter = useTaskProcessStore(
    (state) => state.byProcessId[props.processId]?.filter ?? "all",
  );
  const selectedTaskId = useTaskProcessStore(
    (state) => state.byProcessId[props.processId]?.selectedTaskId ?? null,
  );
  const setView = useTaskProcessStore((state) => state.setView);
  const setFilter = useTaskProcessStore((state) => state.setFilter);
  const selectTask = useTaskProcessStore((state) => state.selectTask);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskRisk, setNewTaskRisk] = useState<ProjectTaskRisk | null>(null);
  const [pending, setPending] = useState(false);
  const selectedTaskProjection =
    graph?.tasks.find((task) => task.task.id === selectedTaskId) ?? null;
  const [retainedTaskId, setRetainedTaskId] = useState<ProjectTaskId | null>(selectedTaskId);
  const firstBoundThreadId =
    graph?.bindings.find(
      (binding) =>
        binding.binding.retiredAt === null &&
        binding.binding.taskId === selectedTaskProjection?.task.id,
    )?.binding.threadId ?? null;
  const progressQuery = useQuery(
    sessionProgressQueryOptions({
      threadId: firstBoundThreadId ?? ("process-progress-pending" as never),
      processId: props.processId,
      enabled: firstBoundThreadId !== null,
      limit: 50,
    }),
  );

  useEffect(() => {
    if (selectedTaskId && graph && !graph.tasks.some((task) => task.task.id === selectedTaskId)) {
      selectTask(props.processId, null);
    }
  }, [graph, props.processId, selectTask, selectedTaskId]);
  useEffect(() => {
    if (selectedTaskId) {
      setRetainedTaskId(selectedTaskId);
      return;
    }
    const cleanup = window.setTimeout(
      () => setRetainedTaskId(null),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [selectedTaskId]);

  if (graphQuery.isPending) return null;
  if (graphQuery.isError || !graph) {
    return (
      <RouteInsetSurface>
        <div className="p-6 text-sm text-destructive">Unable to load this task board.</div>
      </RouteInsetSurface>
    );
  }

  const authority = resolveProcessAuthority(graph);
  const completedTaskCount = graph.tasks.filter((task) => task.task.lifecycle === "done").length;
  const activeTaskCount = graph.tasks.filter(
    (task) => deriveProcessBoardLane(task) === "in_progress",
  ).length;
  const reviewTaskCount = graph.tasks.filter(
    (task) => deriveProcessBoardLane(task) === "review",
  ).length;
  const blockedTaskCount = graph.tasks.filter(
    (task) => deriveProcessBoardLane(task) === "blocked",
  ).length;
  const readyTaskCount = graph.tasks.filter(
    (task) => deriveProcessBoardLane(task) === "ready",
  ).length;
  const completionPercent =
    graph.tasks.length === 0 ? 0 : Math.round((completedTaskCount / graph.tasks.length) * 100);
  const visibleProcesses = (processListQuery.data?.items ?? [graph.process]).filter(
    (process) => process.owner.kind === "user",
  );
  const openProcess = (processId: TaskProcessId) => {
    const target = resolveTaskProcessNavigationTarget(processId, graph.process.owner);
    void navigate({ to: "/tasks/$processId", params: { processId: target.processId } });
  };
  const selectedTask = selectedTaskProjection;
  const drawerTask =
    selectedTask ?? graph.tasks.find((task) => task.task.id === retainedTaskId) ?? null;
  const drawerOpen = selectedTask !== null;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskProcessQueryKeys.graph(props.processId) }),
      queryClient.invalidateQueries({ queryKey: taskProcessQueryKeys.summary(props.processId) }),
      queryClient.invalidateQueries({ queryKey: taskProcessQueryKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: taskProcessQueryKeys.progresses() }),
    ]);
  };
  const commandBase = (expectedRevision = graph.graphRevision) => ({
    commandId: newCommandId(),
    processId: graph.process.id,
    projectId: graph.process.projectId,
    actor: { kind: "user" as const, actorId: "owner" },
    expectedRevision,
    createdAt: new Date().toISOString(),
  });
  const dispatch = async (command: TaskProcessCommand) => {
    if (pending) return;
    setPending(true);
    try {
      await ensureNativeApi().orchestration.dispatchTaskProcessCommand({ command });
      await refresh();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Task change rejected",
        description:
          error instanceof Error ? error.message : "The task board could not be changed.",
      });
    } finally {
      setPending(false);
    }
  };
  const createTask = async () => {
    const title = newTaskTitle.trim();
    if (!title || !newTaskRisk || !authority.canEditGraph) return;
    const taskId = ProjectTaskId.makeUnsafe(crypto.randomUUID());
    await dispatch({
      ...commandBase(),
      type: "project-task.create",
      taskId,
      parentTaskId: null,
      title,
      description: null,
      acceptanceCriteria: [],
      priority: "normal",
      risk: newTaskRisk,
      orderKey: `user:${Date.now().toString(36)}:${taskId}`,
    });
    setNewTaskTitle("");
    setNewTaskRisk(null);
    selectTask(props.processId, taskId);
  };
  const reorderTask = async (taskId: ProjectTaskId, direction: "up" | "down") => {
    if (!authority.canCreateProcess || pending) return;
    const ordered = taskOrder(graph);
    const currentIndex = ordered.findIndex((task) => task.task.id === taskId);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    [ordered[currentIndex], ordered[targetIndex]] = [ordered[targetIndex]!, ordered[currentIndex]!];
    setPending(true);
    try {
      let revision = graph.graphRevision;
      for (const [index, task] of ordered.entries()) {
        const result = await ensureNativeApi().orchestration.dispatchTaskProcessCommand({
          command: {
            ...commandBase(revision),
            type: "project-task.reorder",
            taskId: task.task.id,
            orderKey: `user:${String(index).padStart(8, "0")}`,
          },
        });
        revision = result.mutation.graphRevision;
      }
      await refresh();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Task reorder stopped",
        description:
          error instanceof Error ? error.message : "The latest graph revision must be reloaded.",
      });
      await refresh();
    } finally {
      setPending(false);
    }
  };
  const createSiblingProcess = async () => {
    if (!authority.canEditGraph || pending) return;
    const processId = TaskProcessId.makeUnsafe(crypto.randomUUID());
    setPending(true);
    try {
      await ensureNativeApi().orchestration.dispatchTaskProcessCommand({
        command: {
          ...commandBase(0),
          type: "task-process.create",
          processId,
          title: `${graph.process.title} follow-up`,
          owner: { kind: "user" },
        },
      });
      await queryClient.invalidateQueries({ queryKey: taskProcessQueryKeys.lists() });
      openProcess(processId);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to create task plan",
        description: error instanceof Error ? error.message : "The task plan was not created.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <RouteInsetSurface surfaceClassName="bg-background">
      <div
        className="relative flex h-full min-h-0 min-w-0"
        data-process-workspace={props.processId}
      >
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex min-h-14 items-center gap-3 border-b border-border px-4">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <Select
                  value={props.processId}
                  onValueChange={(value) => openProcess(TaskProcessId.makeUnsafe(value as string))}
                >
                  <SelectTrigger size="sm" variant="ghost" className="max-w-72 font-medium">
                    <SelectValue>{graph.process.title}</SelectValue>
                  </SelectTrigger>
                  <ComposerPickerSelectPopup align="start">
                    {visibleProcesses.map((process) => (
                      <SelectItem key={process.id} value={process.id}>
                        {process.title}
                      </SelectItem>
                    ))}
                  </ComposerPickerSelectPopup>
                </Select>
                {authority.canCreateProcess ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={pending}
                    onClick={createSiblingProcess}
                  >
                    New plan
                  </Button>
                ) : null}
              </div>
              <p className="text-[10px] capitalize text-muted-foreground">
                {authority.mode} authority · revision {graph.graphRevision} · {graph.process.state}
              </p>
            </div>
            {graphQuery.data?.projectionBehind ? (
              <span className="text-[10px] text-warning">Projection catching up</span>
            ) : null}
            <div className="flex rounded-lg border border-border p-0.5">
              <Button
                size="xs"
                variant={view === "board" ? "secondary" : "ghost"}
                onClick={() => setView(props.processId, "board")}
              >
                Overview
              </Button>
              <Button
                size="xs"
                variant={view === "graph" ? "secondary" : "ghost"}
                onClick={() => setView(props.processId, "graph")}
              >
                Dependencies
              </Button>
            </div>
            <Select
              value={filter}
              onValueChange={(value) => setFilter(props.processId, value as TaskProcessFilter)}
            >
              <SelectTrigger size="xs" variant="ghost" aria-label="Filter tasks">
                <SelectValue>
                  {filter === "all" ? "Filter" : filter === "input" ? "Needs input" : filter}
                </SelectValue>
              </SelectTrigger>
              <ComposerPickerSelectPopup align="end">
                {(
                  [
                    "all",
                    "ready",
                    "blocked",
                    "input",
                  ] as const satisfies readonly TaskProcessFilter[]
                ).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "all" ? "All tasks" : item === "input" ? "Needs input" : item}
                  </SelectItem>
                ))}
              </ComposerPickerSelectPopup>
            </Select>
            {graph.process.state === "active" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void dispatch({
                    ...commandBase(),
                    type: "task-process.pause",
                    reason: "Paused by the user",
                  })
                }
              >
                Pause
              </Button>
            ) : graph.process.state === "paused" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={pending}
                onClick={() => void dispatch({ ...commandBase(), type: "task-process.resume" })}
              >
                Resume
              </Button>
            ) : null}
          </header>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border px-4 py-2">
            <div className="min-w-44 flex-1">
              <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                <span>
                  {completedTaskCount} of {graph.tasks.length} complete
                </span>
                <span>{completionPercent}%</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-200 ease-out motion-reduce:transition-none"
                  style={{ width: `${completionPercent}%` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
              <span>{activeTaskCount} active</span>
              <span>{reviewTaskCount} review</span>
              <span>{blockedTaskCount} blocked</span>
              <span>{readyTaskCount} ready</span>
            </div>
          </div>
          {authority.canEditGraph ? (
            <div className="flex gap-2 border-b border-border px-4 py-2">
              <Input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createTask();
                }}
                placeholder="Add a durable ProjectTask"
                aria-label="New task title"
              />
              <Select
                value={newTaskRisk ?? undefined}
                onValueChange={(value) => setNewTaskRisk(value as ProjectTaskRisk)}
              >
                <SelectTrigger className="w-36 shrink-0" aria-label="New task risk">
                  <SelectValue placeholder="Select risk" />
                </SelectTrigger>
                <ComposerPickerSelectPopup align="end">
                  <SelectItem value="high">High risk</SelectItem>
                  <SelectItem value="medium">Medium risk</SelectItem>
                  <SelectItem value="low">Low risk</SelectItem>
                </ComposerPickerSelectPopup>
              </Select>
              <Button
                size="sm"
                disabled={pending || !newTaskTitle.trim() || !newTaskRisk}
                onClick={() => void createTask()}
              >
                Add task
              </Button>
            </div>
          ) : (
            <div className="border-b border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
              Root owns decomposition, dependencies, assignment, provider/model, scheduling, and
              completion semantics.
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            {view === "board" ? (
              <ProcessBoard
                graph={graph}
                filter={filter}
                canEdit={authority.canEditGraph}
                onSelectTask={(taskId) => selectTask(props.processId, taskId)}
                onMoveTask={reorderTask}
              />
            ) : (
              <ProcessGraph
                graph={graph}
                onSelectTask={(taskId) => selectTask(props.processId, taskId)}
              />
            )}
          </div>
        </main>

        <TaskDetailTransitionShell open={drawerOpen}>
          {drawerTask ? (
            <TaskDetailDrawer
              key={drawerTask.task.id}
              task={drawerTask}
              graph={graph}
              progress={progressQuery.data?.progress?.latestProgress ?? []}
              threadOptions={threadOptions}
              canEditGraph={authority.canEditGraph}
              pending={pending}
              onClose={() => selectTask(props.processId, null)}
              onUpdateTask={({ title, description, risk }) =>
                void dispatch({
                  ...commandBase(),
                  type: "project-task.meta.update",
                  taskId: drawerTask.task.id,
                  title,
                  description,
                  risk,
                })
              }
              onSetDependencies={(prerequisiteTaskIds) =>
                void dispatch({
                  ...commandBase(),
                  type: "project-task.dependencies.set",
                  taskId: drawerTask.task.id,
                  prerequisiteTaskIds: [...prerequisiteTaskIds],
                })
              }
              onBindThread={(threadId) =>
                void dispatch({
                  ...commandBase(),
                  type: "project-task.thread.bind",
                  bindingId: TaskThreadBindingId.makeUnsafe(crypto.randomUUID()),
                  taskId: drawerTask.task.id,
                  threadId,
                  assignmentId: null,
                  role: "contributor",
                })
              }
              onTransition={(lifecycle: ProjectTaskLifecycle) =>
                void dispatch({
                  ...commandBase(),
                  type: "project-task.transition",
                  taskId: drawerTask.task.id,
                  lifecycle,
                  reason: "Changed by the user",
                })
              }
              onComplete={(evidenceRefs) =>
                void dispatch({
                  ...commandBase(),
                  type: "project-task.complete",
                  taskId: drawerTask.task.id,
                  assignmentIds: graph.bindings
                    .filter(
                      (binding) =>
                        binding.binding.taskId === drawerTask.task.id &&
                        binding.binding.assignmentId !== null,
                    )
                    .map((binding) => binding.binding.assignmentId!),
                  evidenceRefs: [...evidenceRefs],
                })
              }
              onReopen={() =>
                void dispatch({
                  ...commandBase(),
                  type: "project-task.reopen",
                  taskId: drawerTask.task.id,
                  reason: "Reopened by the user",
                })
              }
              onOpenThread={(threadId) => void navigate({ to: "/$threadId", params: { threadId } })}
            />
          ) : null}
        </TaskDetailTransitionShell>
      </div>
    </RouteInsetSurface>
  );
}
