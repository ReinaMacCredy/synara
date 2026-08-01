import type {
  ProjectTaskId,
  SessionProgressProjection,
  TaskProcessId,
  TaskProcessSummaryProjection,
  ThreadId,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";

import { Button } from "~/components/ui/button";
import { PanelStateMessage } from "~/components/chat/PanelStateMessage";
import { sessionProgressQueryOptions } from "~/lib/serverReactQuery";
import { SessionProgress } from "~/components/process/SessionProgress";
import { useSessionProgressPreferenceStore } from "~/sessionProgressPreferenceStore";

export function RightDockProcessPanelView(props: {
  readonly summary: TaskProcessSummaryProjection | null;
  readonly progress: SessionProgressProjection | null;
  readonly collapsed?: boolean;
  readonly loading?: boolean;
  readonly onCollapsedChange?: (collapsed: boolean) => void;
  readonly onOpenTask?: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  if (!props.summary) {
    return <PanelStateMessage>No active Process is attached to this Root.</PanelStateMessage>;
  }
  const counts = props.summary.counts;
  return (
    <div className="flex h-full min-h-0 flex-col" data-orchestrator-panel="process">
      <div className="border-b border-border/70 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{props.summary.process.title}</p>
            <p className="mt-0.5 text-[10px] capitalize text-muted-foreground">
              {props.summary.process.state} · revision {props.summary.graphRevision}
            </p>
          </div>
          <span className="text-xs font-semibold tabular-nums">
            {counts.done}/{counts.total}
          </span>
        </div>
        <div className="mt-2 flex gap-2 text-[10px] text-muted-foreground">
          <span>{counts.running} running</span>
          <span>{counts.ready} ready</span>
          <span>{counts.blocked} blocked</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {props.loading ? <p className="text-[10px] text-muted-foreground">Loading focus…</p> : null}
        {props.progress ? (
          <SessionProgress
            variant="dock"
            projection={props.progress}
            collapsed={props.collapsed ?? false}
            onCollapsedChange={props.onCollapsedChange ?? (() => undefined)}
            onOpenTask={props.onOpenTask ?? (() => undefined)}
            onOpenProcess={props.onOpenProcess}
          />
        ) : !props.loading ? (
          <p className="py-4 text-center text-[10px] text-muted-foreground">
            No active focus tasks.
          </p>
        ) : null}
      </div>
      {!props.progress ? (
        <div className="border-t border-border p-3">
          <Button
            className="w-full"
            size="sm"
            variant="outline"
            onClick={() => props.onOpenProcess(props.summary!.process.id)}
          >
            Open full process
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function RightDockProcessPanel(props: {
  readonly rootThreadId: ThreadId;
  readonly summary: TaskProcessSummaryProjection | null;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  const processId = props.summary?.process.id;
  const collapsed = useSessionProgressPreferenceStore(
    (state) => state.collapsedByThreadId[props.rootThreadId] ?? false,
  );
  const setCollapsed = useSessionProgressPreferenceStore((state) => state.setCollapsed);
  const progressQuery = useQuery(
    sessionProgressQueryOptions({
      threadId: props.rootThreadId,
      ...(processId ? { processId } : {}),
      enabled: processId !== undefined,
      limit: 16,
    }),
  );
  return (
    <RightDockProcessPanelView
      summary={props.summary}
      progress={progressQuery.data?.progress ?? null}
      collapsed={collapsed}
      loading={progressQuery.isPending && processId !== undefined}
      onCollapsedChange={(next) => setCollapsed(props.rootThreadId, next)}
      onOpenTask={props.onOpenTask}
      onOpenProcess={props.onOpenProcess}
    />
  );
}
