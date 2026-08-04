import type { SupervisionDraftMode } from "@synara/contracts";

import { EyeIcon, WorkflowIcon } from "~/lib/icons";
import { Button } from "../ui/button";

export function ComposerOrchestrationModeSwitch(props: {
  readonly mode: SupervisionDraftMode;
  readonly disabled?: boolean;
  readonly unavailableReason?: string | null;
  readonly title?: string;
  readonly onToggle: () => void;
}) {
  const supervised = props.mode === "supervise";
  const Icon = supervised ? EyeIcon : WorkflowIcon;
  const label = supervised ? "Supervise" : "Orchestrate";
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      disabled={props.disabled ?? false}
      aria-label={`${label} mode. Activate to switch to ${supervised ? "Orchestrate" : "Supervise"}.`}
      aria-pressed={supervised}
      data-testid="composer-orchestration-mode-switch"
      data-mode={props.mode}
      title={props.unavailableReason ?? props.title ?? `${label} mode · Shift+Tab`}
        className="min-w-[7.5rem] shrink-0 justify-start gap-1.5 px-2.5 font-normal text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]"
      onClick={props.onToggle}
    >
      <Icon className="size-3.5" />
      <span>{label}</span>
    </Button>
  );
}
