import type { ProjectTaskRisk } from "@synara/contracts";

import { cn } from "~/lib/utils";

const RISK_LABELS: Record<ProjectTaskRisk, string> = {
  high: "High risk",
  medium: "Medium risk",
  low: "Low risk",
};

const RISK_CLASSES: Record<ProjectTaskRisk, string> = {
  high: "border-destructive/25 bg-destructive/10 text-destructive",
  medium: "border-warning/25 bg-warning/10 text-warning",
  low: "border-border bg-muted/70 text-muted-foreground",
};

export function TaskRiskIcon(props: { readonly className?: string }) {
  return (
    <svg
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 19 6v5c0 4.6-2.7 7.8-7 10-4.3-2.2-7-5.4-7-10V6l7-3Z" />
      <path d="m8.6 9.2 2 1.8-2 1.8" />
      <path d="M12.6 13h2.8" />
    </svg>
  );
}

export function TaskRiskBadge(props: {
  readonly risk: ProjectTaskRisk;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const label = RISK_LABELS[props.risk];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border font-medium",
        props.compact ? "gap-1 px-1.5 py-0.5 text-[9px]" : "gap-1.5 px-2 py-1 text-[10px]",
        RISK_CLASSES[props.risk],
        props.className,
      )}
      data-task-risk={props.risk}
      aria-label={label}
    >
      <TaskRiskIcon className={props.compact ? "size-3" : "size-3.5"} />
      <span>{label}</span>
    </span>
  );
}
