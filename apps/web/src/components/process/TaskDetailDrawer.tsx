import type {
  ProjectTaskId,
  ProjectTaskLifecycle,
  ProjectTaskProjection,
  ProjectTaskRisk,
  TaskProcessGraphProjection,
  TaskProgressEntry,
  ThreadId,
} from "@synara/contracts";
import { useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

import { TaskRiskBadge } from "./TaskRiskBadge";

export interface ProcessThreadOption {
  readonly id: ThreadId;
  readonly title: string;
}

const PROJECT_LIFECYCLE_ACTIONS: readonly ProjectTaskLifecycle[] = [
  "planned",
  "in_progress",
  "review",
  "paused",
  "failed",
  "cancelled",
];

export function TaskDetailDrawer(props: {
  readonly task: ProjectTaskProjection;
  readonly graph: TaskProcessGraphProjection;
  readonly progress: readonly TaskProgressEntry[];
  readonly threadOptions: readonly ProcessThreadOption[];
  readonly canEditGraph: boolean;
  readonly pending?: boolean;
  readonly onClose: () => void;
  readonly onUpdateTask: (input: {
    title: string;
    description: string | null;
    risk: ProjectTaskRisk;
  }) => void;
  readonly onSetDependencies: (taskIds: readonly ProjectTaskId[]) => void;
  readonly onBindThread: (threadId: ThreadId) => void;
  readonly onTransition: (lifecycle: ProjectTaskLifecycle) => void;
  readonly onComplete: (evidenceRefs: readonly string[]) => void;
  readonly onReopen: () => void;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const taskId = props.task.task.id;
  const [title, setTitle] = useState(props.task.task.title);
  const [description, setDescription] = useState(props.task.task.description ?? "");
  const [risk, setRisk] = useState<ProjectTaskRisk>(props.task.task.risk);
  const [threadId, setThreadId] = useState("");
  const dependencyIds = useMemo(
    () =>
      new Set(
        props.graph.dependencies
          .filter((edge) => edge.dependentTaskId === taskId && edge.state === "active")
          .map((edge) => edge.prerequisiteTaskId),
      ),
    [props.graph.dependencies, taskId],
  );
  const dependents = props.graph.dependencies
    .filter((edge) => edge.prerequisiteTaskId === taskId && edge.state === "active")
    .map((edge) => props.graph.tasks.find((task) => task.task.id === edge.dependentTaskId))
    .filter((task): task is ProjectTaskProjection => task !== undefined);
  const bindings = props.graph.bindings.filter(
    (binding) => binding.binding.taskId === taskId && binding.binding.retiredAt === null,
  );
  const taskProgress = props.progress.filter((entry) => entry.taskId === taskId);
  const evidenceRefs = [...new Set(taskProgress.flatMap((entry) => entry.evidenceRefs))];
  const canReopen = ["done", "failed", "cancelled"].includes(props.task.task.lifecycle);

  return (
    <aside
      className="flex h-full w-full min-w-[20rem] flex-col border-l border-border bg-background"
      aria-label={`Task details: ${props.task.task.title}`}
      data-task-detail-drawer={taskId}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {taskId}
          </p>
          <h2 className="mt-1 text-sm font-semibold">{props.task.task.title}</h2>
          <p className="mt-1 text-[10px] capitalize text-muted-foreground">
            {props.task.task.lifecycle} · {props.task.readiness} · {props.task.executionHealth}
          </p>
          <TaskRiskBadge risk={props.task.task.risk} className="mt-2" />
        </div>
        <Button size="xs" variant="ghost" onClick={props.onClose} aria-label="Close task details">
          Close
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-xs">
        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Summary
          </h3>
          {props.canEditGraph ? (
            <div className="grid gap-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                aria-label="Task title"
              />
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-label="Task description"
                placeholder="Describe the durable outcome"
              />
              <label className="grid gap-1 text-[10px] font-medium text-muted-foreground">
                Task risk
                <select
                  className="min-h-9 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
                  value={risk}
                  onChange={(event) => setRisk(event.target.value as ProjectTaskRisk)}
                  aria-label="Task risk"
                >
                  <option value="high">High risk</option>
                  <option value="medium">Medium risk</option>
                  <option value="low">Low risk</option>
                </select>
              </label>
              <Button
                size="sm"
                disabled={props.pending || title.trim().length === 0}
                onClick={() =>
                  props.onUpdateTask({
                    title: title.trim(),
                    description: description.trim() || null,
                    risk,
                  })
                }
              >
                Save task
              </Button>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-muted-foreground">
              {props.task.task.description ?? "No description."}
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Dependencies
          </h3>
          <div className="grid gap-1.5">
            {props.graph.tasks
              .filter(
                (candidate) =>
                  candidate.task.id !== taskId &&
                  (props.canEditGraph || dependencyIds.has(candidate.task.id)),
              )
              .map((candidate) => (
                <label
                  key={candidate.task.id}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  {props.canEditGraph ? (
                    <input
                      type="checkbox"
                      checked={dependencyIds.has(candidate.task.id)}
                      disabled={props.pending}
                      onChange={() => {
                        const next = new Set(dependencyIds);
                        if (next.has(candidate.task.id)) next.delete(candidate.task.id);
                        else next.add(candidate.task.id);
                        props.onSetDependencies([...next]);
                      }}
                    />
                  ) : (
                    <span aria-hidden>{dependencyIds.has(candidate.task.id) ? "✓" : "·"}</span>
                  )}
                  <span>{candidate.task.title}</span>
                </label>
              ))}
            {dependencyIds.size === 0 ? (
              <p className="text-muted-foreground">No prerequisites.</p>
            ) : null}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Execution
          </h3>
          <div className="grid gap-2">
            {bindings.map((binding) => (
              <button
                key={binding.binding.id}
                type="button"
                className="rounded-lg border border-border p-2 text-left"
                onClick={() => props.onOpenThread(binding.binding.threadId)}
              >
                <span className="font-medium">{binding.binding.threadId}</span>
                <span className="ml-2 capitalize text-muted-foreground">
                  {binding.binding.role} · {binding.executionHealth}
                </span>
              </button>
            ))}
            {bindings.length === 0 ? (
              <p className="text-muted-foreground">No thread binding.</p>
            ) : null}
            {props.canEditGraph && props.threadOptions.length > 0 ? (
              <div className="flex gap-2">
                <select
                  className="min-h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2"
                  value={threadId}
                  onChange={(event) => setThreadId(event.target.value)}
                  aria-label="Thread to bind"
                >
                  <option value="">Select thread</option>
                  {props.threadOptions.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.title}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!threadId || props.pending}
                  onClick={() => props.onBindThread(threadId as ThreadId)}
                >
                  Bind
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Progress and evidence
          </h3>
          <div className="grid gap-2">
            {taskProgress.map((entry) => (
              <article key={entry.id} className="rounded-lg border border-border p-2">
                <p>{entry.summary}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {entry.kind} · {entry.createdAt}
                </p>
                {entry.evidenceRefs.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-[10px] text-muted-foreground">
                    {entry.evidenceRefs.map((reference) => (
                      <li key={reference}>{reference}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {taskProgress.length === 0 ? (
              <p className="text-muted-foreground">
                No progress evidence in this session projection.
              </p>
            ) : null}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Unblocks
          </h3>
          {dependents.length > 0 ? (
            <ul className="grid gap-1 text-muted-foreground">
              {dependents.map((task) => (
                <li key={task.task.id}>{task.task.title}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No dependent tasks.</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lifecycle
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {props.canEditGraph
              ? PROJECT_LIFECYCLE_ACTIONS.map((lifecycle) => (
                  <Button
                    key={lifecycle}
                    size="xs"
                    variant="outline"
                    disabled={props.pending || lifecycle === props.task.task.lifecycle}
                    onClick={() => props.onTransition(lifecycle)}
                  >
                    {lifecycle.replaceAll("_", " ")}
                  </Button>
                ))
              : null}
            {props.canEditGraph && props.task.task.lifecycle !== "done" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={props.pending || evidenceRefs.length === 0}
                title={
                  evidenceRefs.length === 0 ? "Completion requires accepted evidence" : undefined
                }
                onClick={() => props.onComplete(evidenceRefs)}
              >
                Complete with evidence
              </Button>
            ) : null}
            {!props.canEditGraph && !canReopen && props.task.task.lifecycle !== "cancelled" ? (
              <Button
                size="xs"
                variant="outline"
                disabled={props.pending}
                onClick={() => props.onTransition("cancelled")}
              >
                Cancel task
              </Button>
            ) : null}
            {canReopen ? (
              <Button size="xs" variant="outline" disabled={props.pending} onClick={props.onReopen}>
                Reopen task
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </aside>
  );
}
