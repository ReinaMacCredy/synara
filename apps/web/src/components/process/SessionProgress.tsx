import type {
  ProjectTaskId,
  ProjectTaskProjection,
  SessionProgressProjection,
  TaskProcessId,
} from "@veylen/contracts";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { useNowMs } from "~/hooks/useNowMs";
import { cn } from "~/lib/utils";
import { formatClockDuration } from "~/session-logic";

import styles from "./SessionProgress.module.css";
import {
  deriveSessionProgressActivity,
  sessionProgressStateLabel,
  type SessionProgressActivity,
} from "./sessionProgressPresentation";
import { TaskRiskBadge } from "./TaskRiskBadge";

export type SessionProgressVariant = "composer" | "inspector" | "dock";

export interface SessionProgressProps {
  readonly variant: SessionProgressVariant;
  readonly projection: SessionProgressProjection;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
  readonly onDismissFailure?: () => void;
}

type VisualState = "complete" | "active" | "pending" | "blocked" | "failed" | "cancelled";

export function resolveSessionProgressVisualState(task: ProjectTaskProjection): VisualState {
  if (task.task.lifecycle === "done") return "complete";
  if (task.task.lifecycle === "failed") return "failed";
  if (task.task.lifecycle === "cancelled") return "cancelled";
  if (task.readiness === "blocked") return "blocked";
  if (task.executionHealth === "running") return "active";
  return "pending";
}

function TaskGlyph(props: { readonly state: VisualState }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (props.state === "complete") {
    return (
      <svg {...common}>
        <path d="m3.25 8.25 2.8 2.8 6.7-6.7" />
      </svg>
    );
  }
  if (props.state === "active") {
    return (
      <svg {...common}>
        <path d="M12.4 5.2A5 5 0 1 0 13 9" />
        <path d="M9.8 3.7h3.1v3.1" />
      </svg>
    );
  }
  if (props.state === "blocked") {
    return (
      <svg {...common}>
        <path d="M6.1 9.9 4.8 11.2a2.1 2.1 0 0 1-3-3L4 6" />
        <path d="m9.9 6.1 1.3-1.3a2.1 2.1 0 0 1 3 3L12 10" />
        <path d="m5.5 10.5 5-5" />
      </svg>
    );
  }
  if (props.state === "failed") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" />
      </svg>
    );
  }
  if (props.state === "cancelled") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="5.5" />
        <path d="m4.1 11.9 7.8-7.8" />
      </svg>
    );
  }
  return (
    <svg {...common} className={styles.pendingGlyph}>
      <circle cx="8" cy="8" r="5.25" strokeDasharray="2.2 2.2" />
    </svg>
  );
}

function useChangeRevision(signature: string): number {
  const previous = useRef(signature);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    setRevision((current) => current + 1);
  }, [signature]);
  return revision;
}

function RollingCount(props: { readonly completed: number; readonly total: number }) {
  const signature = `${props.completed}/${props.total}`;
  const revision = useChangeRevision(signature);
  return (
    <span
      key={revision}
      className={cn(styles.count, revision > 0 && styles.countChanged)}
      aria-label={`${props.completed} of ${props.total} completed`}
    >
      {signature}
    </span>
  );
}

function ProgressPie(props: {
  readonly completed: number;
  readonly total: number;
  readonly done: boolean;
}) {
  const percent = props.total === 0 ? 0 : Math.round((props.completed / props.total) * 100);
  if (props.done) {
    return (
      <span className={styles.completeHeaderGlyph}>
        <TaskGlyph state="complete" />
      </span>
    );
  }
  return (
    <span
      className={styles.progressPie}
      style={{ "--session-progress-percent": `${percent}%` } as CSSProperties}
      aria-hidden
    />
  );
}

function SessionProgressRow(props: {
  readonly task: SessionProgressProjection["visibleTasks"][number];
  readonly statusMeta?: string | null;
  readonly onOpen: () => void;
}) {
  const visualState = resolveSessionProgressVisualState(props.task.task);
  const semanticSignature = `${props.task.task.task.lifecycle}:${props.task.task.readiness}:${props.task.task.executionHealth}`;
  const revision = useChangeRevision(semanticSignature);
  return (
    <button
      type="button"
      className={cn(styles.item, styles[visualState], revision > 0 && styles.itemChanged)}
      onClick={props.onOpen}
      aria-label={`${props.task.task.task.title}: ${visualState}`}
    >
      <span className={styles.iconWrap}>
        <TaskGlyph state={visualState} />
      </span>
      <span className={styles.itemBody}>
        <span className={styles.itemTitleRow}>
          <span className={styles.itemTitle}>{props.task.task.task.title}</span>
          <TaskRiskBadge risk={props.task.task.task.risk} compact />
        </span>
        {props.statusMeta ? (
          <span className={styles.itemMeta}>{props.statusMeta}</span>
        ) : props.task.blockedByTitles.length > 0 ? (
          <span className={styles.itemMeta}>
            blocked by {props.task.blockedByTitles.join(", ")}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function activityElapsed(activity: SessionProgressActivity, nowMs: number): string | null {
  if (!activity.startedAt) return null;
  const startedAtMs = Date.parse(activity.startedAt);
  if (Number.isNaN(startedAtMs) || startedAtMs > nowMs) return null;
  return formatClockDuration(nowMs - startedAtMs);
}

function activityMeta(activity: SessionProgressActivity, elapsed: string | null): string {
  const step =
    activity.stepIndex > 0 ? `step ${activity.stepIndex} of ${activity.totalCount}` : null;
  const state = sessionProgressStateLabel(activity.state);
  return [`${state}${step ? ` ${step}` : ""}`, elapsed].filter(Boolean).join(" · ");
}

function rowStatusMeta(
  task: SessionProgressProjection["visibleTasks"][number],
  activity: SessionProgressActivity,
  elapsed: string | null,
): string | null {
  if (task.task.task.id !== activity.taskId) return null;
  if (activity.state === "running") return ["Running", elapsed].filter(Boolean).join(" · ");
  if (activity.state === "waiting") return "Waiting";
  if (activity.state === "review") return "Review required";
  if (activity.state === "failed") return "Failed";
  return null;
}

export function SessionProgress(props: SessionProgressProps) {
  const { projection } = props;
  const activity = deriveSessionProgressActivity(projection);
  const allDone = projection.totalCount > 0 && projection.completedCount === projection.totalCount;
  const liveElapsed = activity.state === "running" || activity.state === "waiting";
  const nowMs = useNowMs(liveElapsed);
  const elapsed = activityElapsed(activity, nowMs);
  const headerTitle = allDone
    ? "Process completed"
    : activity.state === "waiting"
      ? `Waiting for ${activity.title}`
      : activity.title;
  const headerMeta = activityMeta(activity, elapsed);
  const activeTaskId = activity.taskId;
  const lifecycleSignature = useMemo(
    () =>
      projection.visibleTasks
        .map((item) => `${item.task.task.id}:${item.task.task.lifecycle}:${item.task.readiness}`)
        .join("|"),
    [projection.visibleTasks],
  );
  const previousLifecycleSignature = useRef(lifecycleSignature);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (previousLifecycleSignature.current === lifecycleSignature) return;
    previousLifecycleSignature.current = lifecycleSignature;
    setAnnouncement(
      `${headerTitle}. ${projection.completedCount} of ${projection.totalCount} completed.`,
    );
  }, [headerTitle, lifecycleSignature, projection.completedCount, projection.totalCount]);

  return (
    <section
      className={cn(
        styles.root,
        styles[props.variant],
        activity.state === "review" && styles.reviewRoot,
        activity.state === "failed" && styles.failedRoot,
      )}
      data-session-progress={props.variant}
      data-process-id={projection.processId}
      data-process-activity-state={activity.state}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.disclosureTrigger}
          aria-expanded={!props.collapsed}
          aria-label={`${headerTitle}: ${headerMeta}`}
          onClick={() => props.onCollapsedChange(!props.collapsed)}
        >
          <ProgressPie
            completed={projection.completedCount}
            total={projection.totalCount}
            done={allDone}
          />
          <span className={styles.headerBody}>
            <span className={styles.headerTitle}>{headerTitle}</span>
            <span className={styles.headerMeta}>{headerMeta}</span>
          </span>
        </button>
        {activity.state === "review" && activeTaskId ? (
          <button
            type="button"
            className={styles.headerAction}
            onClick={() => props.onOpenTask(activeTaskId)}
          >
            Review
          </button>
        ) : (
          <button
            type="button"
            className={styles.headerAction}
            onClick={() => props.onOpenProcess(projection.processId)}
          >
            Open Process
          </button>
        )}
        {activity.state === "failed" && props.onDismissFailure ? (
          <button
            type="button"
            className={styles.dismissAction}
            aria-label="Dismiss failed process activity"
            onClick={props.onDismissFailure}
          >
            Dismiss
          </button>
        ) : null}
        <button
          type="button"
          className={styles.chevronButton}
          aria-label={props.collapsed ? "Expand process activity" : "Collapse process activity"}
          aria-expanded={!props.collapsed}
          onClick={() => props.onCollapsedChange(!props.collapsed)}
        >
          <span className={styles.chevronWrap} aria-hidden>
            <svg
              className={styles.chevron}
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d={props.collapsed ? "m3.5 5.25 3.5 3.5 3.5-3.5" : "m3.5 8.75 3.5-3.5 3.5 3.5"}
              />
            </svg>
            <svg
              className={styles.chevronHover}
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path
                d={props.collapsed ? "m3.5 5.25 3.5 3.5 3.5-3.5" : "m3.5 8.75 3.5-3.5 3.5 3.5"}
              />
            </svg>
          </span>
        </button>
      </div>

      <DisclosureRegion open={!props.collapsed} contentClassName={styles.disclosureContent!}>
        <div className={styles.expandedSummary}>
          <RollingCount completed={projection.completedCount} total={projection.totalCount} />
          <span>complete</span>
        </div>
        <div className={styles.list}>
          {projection.visibleTasks.map((task) => (
            <SessionProgressRow
              key={task.task.task.id}
              task={task}
              statusMeta={rowStatusMeta(task, activity, elapsed)}
              onOpen={() => props.onOpenTask(task.task.task.id)}
            />
          ))}
        </div>
        <div className={styles.footer}>
          <button type="button" onClick={() => props.onOpenProcess(projection.processId)}>
            View full process →
          </button>
          {projection.hasMore ? <span>More activity available</span> : null}
          {projection.projectionBehind ? <span>Projection catching up</span> : null}
        </div>
      </DisclosureRegion>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </section>
  );
}

export function SessionProgressCheckpoint(props: {
  readonly projection: SessionProgressProjection;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
}) {
  const activity = deriveSessionProgressActivity(props.projection);
  if (activity.state !== "completed") return null;
  return (
    <div className={styles.checkpointFrame} data-process-completion-checkpoint="true">
      <button
        type="button"
        className={styles.checkpoint}
        onClick={() => props.onOpenProcess(props.projection.processId)}
      >
        <span className={styles.completeHeaderGlyph}>
          <TaskGlyph state="complete" />
        </span>
        <span className={styles.checkpointBody}>
          <span className={styles.checkpointTitle}>Process completed</span>
          <span className={styles.checkpointMeta}>
            {props.projection.completedCount} of {props.projection.totalCount} steps complete
          </span>
        </span>
        <span className={styles.checkpointAction}>Open Process</span>
      </button>
    </div>
  );
}
