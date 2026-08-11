import type { ProjectTaskId, SessionProgressProjection, TaskProcessId } from "@veylen/contracts";

import { SessionProgress } from "~/components/process/SessionProgress";
import { useSessionProgressPreferenceStore } from "~/sessionProgressPreferenceStore";

import { EnvironmentSectionDivider, EnvironmentSectionLabel } from "./EnvironmentRow";

export function EnvironmentProgressSection(props: {
  readonly projection: SessionProgressProjection;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  const threadId = props.projection.threadId;
  const collapsed = useSessionProgressPreferenceStore(
    (state) => state.collapsedByThreadId[threadId] ?? false,
  );
  const setCollapsed = useSessionProgressPreferenceStore((state) => state.setCollapsed);
  return (
    <>
      <EnvironmentSectionDivider />
      <div className="flex flex-col gap-0.5" data-environment-progress="true">
        <EnvironmentSectionLabel>Progress</EnvironmentSectionLabel>
        <SessionProgress
          variant="inspector"
          projection={props.projection}
          collapsed={collapsed}
          onCollapsedChange={(next) => setCollapsed(threadId, next)}
          onOpenTask={props.onOpenTask}
          onOpenProcess={props.onOpenProcess}
        />
      </div>
    </>
  );
}
