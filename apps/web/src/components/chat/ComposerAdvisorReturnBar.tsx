import { BackToParentIcon } from "~/lib/icons";

import { ComposerStackedPanel } from "./ComposerStackedPanel";

interface ComposerAdvisorReturnBarProps {
  parentTitle: string;
  attachedToPrevious: boolean;
  onBack: () => void;
}

export function ComposerAdvisorReturnBar({
  parentTitle,
  attachedToPrevious,
  onBack,
}: ComposerAdvisorReturnBarProps) {
  return (
    <ComposerStackedPanel
      attachedToPrevious={attachedToPrevious}
      passthroughSideMargins
      data-testid="composer-advisor-return"
    >
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 px-3 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        onClick={onBack}
        aria-label={`Back to main task: ${parentTitle}`}
      >
        <BackToParentIcon className="size-3.5 shrink-0" />
        <span className="shrink-0">Back to main task</span>
        <span className="min-w-0 truncate text-foreground/75">{parentTitle}</span>
      </button>
    </ComposerStackedPanel>
  );
}
