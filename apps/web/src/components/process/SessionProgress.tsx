import type {
  ProjectTaskId,
  ProjectTaskProjection,
  SessionProgressProjection,
  TaskProcessId,
} from "@synara/contracts";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { cn } from "~/lib/utils";

import styles from "./SessionProgress.module.css";

export type SessionProgressVariant = "composer" | "inspector" | "dock";

export interface SessionProgressProps {
  readonly variant: SessionProgressVariant;
  readonly projection: SessionProgressProjection;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly onOpenTask: (taskId: ProjectTaskId) => void;
  readonly onOpenProcess: (processId: TaskProcessId) => void;
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
        <span className={styles.itemTitle}>{props.task.task.task.title}</span>
        {props.task.blockedByTitles.length > 0 ? (
          <span className={styles.itemMeta}>
            blocked by {props.task.blockedByTitles.join(", ")}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function SessionProgress(props: SessionProgressProps) {
  const { projection } = props;
  const running = projection.visibleTasks.filter(
    (item) => resolveSessionProgressVisualState(item.task) === "active",
  );
  const allDone = projection.totalCount > 0 && projection.completedCount === projection.totalCount;
  const primary =
    projection.primaryTask ?? running[0]?.task ?? projection.visibleTasks[0]?.task ?? null;
  const primaryBinding = primary
    ? (projection.boundThreads.find((binding) => binding.taskId === primary.task.id) ?? null)
    : null;
  const headerTitle = allDone
    ? "All tasks completed"
    : running.length > 1
      ? `${running.length} tasks running · ${running
          .slice(0, 2)
          .map((item) => item.task.task.title)
          .join(" + ")}`
      : (primary?.task.title ?? "Process progress");
  const headerMeta = primaryBinding
    ? [primaryBinding.threadId, primaryBinding.model, primaryBinding.executionHealth]
        .filter(Boolean)
        .join(" · ")
    : primary
      ? `${primary.readiness} · ${primary.executionHealth}`
      : null;
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
      className={cn(styles.root, styles[props.variant])}
      data-session-progress={props.variant}
      data-process-id={projection.processId}
    >
      <button
        type="button"
        className={styles.header}
        aria-expanded={!props.collapsed}
        onClick={() => props.onCollapsedChange(!props.collapsed)}
      >
        <ProgressPie
          completed={projection.completedCount}
          total={projection.totalCount}
          done={allDone}
        />
        <span className={styles.headerBody}>
          <span className={styles.headerTitle}>{headerTitle}</span>
          {headerMeta ? <span className={styles.headerMeta}>{headerMeta}</span> : null}
        </span>
        <RollingCount completed={projection.completedCount} total={projection.totalCount} />
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
            <path d={props.collapsed ? "m3.5 5.25 3.5 3.5 3.5-3.5" : "m3.5 8.75 3.5-3.5 3.5 3.5"} />
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
            <path d={props.collapsed ? "m3.5 5.25 3.5 3.5 3.5-3.5" : "m3.5 8.75 3.5-3.5 3.5 3.5"} />
          </svg>
        </span>
      </button>

      <DisclosureRegion open={!props.collapsed} contentClassName={styles.disclosureContent!}>
        <div className={styles.list}>
          {projection.visibleTasks.map((task) => (
            <SessionProgressRow
              key={task.task.task.id}
              task={task}
              onOpen={() => props.onOpenTask(task.task.task.id)}
            />
          ))}
        </div>
        <div className={styles.footer}>
          {primary ? (
            <button type="button" onClick={() => props.onOpenTask(primary.task.id)}>
              Open task
            </button>
          ) : null}
          <button type="button" onClick={() => props.onOpenProcess(projection.processId)}>
            Full process
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
