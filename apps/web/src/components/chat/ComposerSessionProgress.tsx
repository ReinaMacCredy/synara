import type { ProjectTaskId, SessionProgressProjection, TaskProcessId } from "@synara/contracts";

import { useSessionProgressPreferenceStore } from "~/sessionProgressPreferenceStore";
import { SessionProgress } from "~/components/process/SessionProgress";
import { deriveSessionProgressActivity } from "~/components/process/sessionProgressPresentation";

import { ComposerStackedPanel } from "./ComposerStackedPanel";

export function ComposerSessionProgress(props: {
  readonly projection: SessionProgressProjection;
  readonly attachedToPrevious?: boolean;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  const threadId = props.projection.threadId;
  const collapsed = useSessionProgressPreferenceStore(
    (state) => state.collapsedByThreadId[threadId] ?? true,
  );
  const setCollapsed = useSessionProgressPreferenceStore((state) => state.setCollapsed);
  const failureDismissed = useSessionProgressPreferenceStore((state) =>
    state.isFailureDismissed(threadId, props.projection.cursor),
  );
  const dismissFailure = useSessionProgressPreferenceStore((state) => state.dismissFailure);
  const activity = deriveSessionProgressActivity(props.projection);
  if (activity.state === "inactive" || activity.state === "completed") return null;
  if (activity.state === "failed" && failureDismissed) return null;

  const openTask = (taskId: ProjectTaskId) => {
    if (activity.state === "failed") dismissFailure(threadId, props.projection.cursor);
    props.onOpenTask(taskId);
  };
  return (
    <ComposerStackedPanel
      passthroughSideMargins
      attachedToPrevious={props.attachedToPrevious ?? false}
      data-testid="session-progress-card"
      data-canonical-task-process="true"
    >
      <SessionProgress
        variant="composer"
        projection={props.projection}
        collapsed={collapsed}
        onCollapsedChange={(next) => setCollapsed(threadId, next)}
        onOpenTask={openTask}
        onOpenProcess={props.onOpenProcess}
        onDismissFailure={() => dismissFailure(threadId, props.projection.cursor)}
      />
    </ComposerStackedPanel>
  );
}
