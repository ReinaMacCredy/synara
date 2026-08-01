import type { ProjectTaskId, SessionProgressProjection, TaskProcessId } from "@synara/contracts";

import { useSessionProgressPreferenceStore } from "~/sessionProgressPreferenceStore";
import { SessionProgress } from "~/components/process/SessionProgress";

import { ComposerStackedPanel } from "./ComposerStackedPanel";

export function ComposerSessionProgress(props: {
  readonly projection: SessionProgressProjection;
  readonly attachedToPrevious?: boolean;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  const threadId = props.projection.threadId;
  const collapsed = useSessionProgressPreferenceStore(
    (state) => state.collapsedByThreadId[threadId] ?? false,
  );
  const setCollapsed = useSessionProgressPreferenceStore((state) => state.setCollapsed);
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
        onOpenTask={props.onOpenTask}
        onOpenProcess={props.onOpenProcess}
      />
    </ComposerStackedPanel>
  );
}
