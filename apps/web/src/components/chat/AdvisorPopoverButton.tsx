import type { ModelSelection, ProviderKind } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type KeyboardEvent } from "react";

import { useAppSettings } from "~/appSettings";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { useProviderStatusesForLocalConfig } from "~/hooks/useProviderStatusesForLocalConfig";
import { AdvisorIcon, LoaderIcon } from "~/lib/icons";
import { resolveProviderDiscoveryCwd } from "~/lib/providerDiscovery";
import { serverConfigQueryOptions } from "~/lib/serverReactQuery";
import { buildModelSelection } from "~/providerModelOptions";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import {
  Popover,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "../ui/popover";
import { Textarea } from "../ui/textarea";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { resolveRuntimeModelDescriptor } from "./runtimeModelCapabilities";

interface AdvisorPopoverButtonProps {
  disabled: boolean;
  disabledReason: string;
  active: boolean;
  defaultModelSelection: ModelSelection;
  projectCwd: string | null;
  onAsk: (question: string, modelSelection: ModelSelection) => Promise<boolean>;
}

export function AdvisorPopoverButton({
  disabled,
  disabledReason,
  active,
  defaultModelSelection,
  projectCwd,
  onAsk,
}: AdvisorPopoverButtonProps) {
  const { settings } = useAppSettings();
  const serverConfigQuery = useQuery(serverConfigQueryOptions());
  const providerStatuses = useProviderStatusesForLocalConfig();
  const [open, setOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [modelSelection, setModelSelection] = useState<ModelSelection>(defaultModelSelection);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerModelDiscoveryCwd = resolveProviderDiscoveryCwd({
    activeThreadWorktreePath: null,
    activeProjectCwd: projectCwd,
    serverCwd: serverConfigQuery.data?.cwd ?? null,
  });
  const modelHintByProvider = useMemo<Partial<Record<ProviderKind, string | null>>>(
    () => ({ [modelSelection.provider]: modelSelection.model }),
    [modelSelection.model, modelSelection.provider],
  );
  const { modelOptionsByProvider, loadingModelProviders, runtimeModelsByProvider } =
    useProviderModelCatalog({
      selectedProvider: modelSelection.provider,
      discoveryEnabled: open,
      cwd: providerModelDiscoveryCwd,
      modelHintByProvider,
    });

  const setPopoverOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setModelSelection(defaultModelSelection);
      setError(null);
    } else {
      setModelPickerOpen(false);
    }
    setOpen(nextOpen);
  };

  const submit = async () => {
    const normalized = question.trim();
    if (!normalized || submitting || disabled) {
      setError(normalized ? null : "Enter a question for Advisor.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const succeeded = await onAsk(normalized, modelSelection).catch(() => false);
    setSubmitting(false);
    if (!succeeded) {
      setError("Advisor could not start. Check the task and try again.");
      return;
    }
    setQuestion("");
    setPopoverOpen(false);
  };

  const onQuestionKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    void submit();
  };

  const title = disabled ? disabledReason : "Ask Advisor for a second opinion";
  return (
    <Popover open={open} onOpenChange={setPopoverOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            title={title}
            aria-label={title}
            className="ml-auto shrink-0 gap-1.5 whitespace-nowrap px-2 text-[length:var(--app-font-size-ui-sm,11px)] font-normal text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)] sm:px-2.5"
            data-testid="advisor-trigger"
          >
            {active ? (
              <LoaderIcon className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <AdvisorIcon className="size-3.5 shrink-0" />
            )}
            <span>Advisor</span>
          </Button>
        }
      />
      <PopoverPopup
        side="top"
        align="end"
        sideOffset={8}
        className="w-[min(25rem,calc(100vw-2rem))] rounded-xl shadow-xl/15"
        data-testid="advisor-popover"
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <PopoverTitle className="text-sm">Ask Advisor</PopoverTitle>
            <PopoverDescription className="text-xs leading-relaxed">
              Get an advice-only second opinion. Advisor cannot edit the task or apply changes.
            </PopoverDescription>
          </div>
          <Textarea
            autoFocus
            size="sm"
            value={question}
            onChange={(event) => {
              setQuestion(event.currentTarget.value);
              if (error) setError(null);
            }}
            onKeyDown={onQuestionKeyDown}
            placeholder="What should Advisor review?"
            aria-label="Question for Advisor"
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2.5">
            <span className="text-[11px] text-muted-foreground">Advisor model</span>
            <ProviderModelPicker
              compact
              provider={modelSelection.provider}
              model={modelSelection.model}
              lockedProvider={null}
              providers={providerStatuses}
              modelOptionsByProvider={modelOptionsByProvider}
              loadingModelProviders={loadingModelProviders}
              hiddenProviders={settings.hiddenProviders}
              providerOrder={settings.providerOrder}
              open={modelPickerOpen}
              onOpenChange={setModelPickerOpen}
              onProviderModelChange={(provider, model) => {
                const runtimeModel = resolveRuntimeModelDescriptor({
                  provider,
                  model,
                  runtimeModels: runtimeModelsByProvider[provider],
                });
                setModelSelection(
                  buildModelSelection(
                    provider,
                    model,
                    undefined,
                    provider === "claudeAgent" ? runtimeModel?.supportsAutoMode : undefined,
                  ),
                );
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPopoverOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={submitting || question.trim().length === 0}
                onClick={() => void submit()}
                className={cn("min-w-19", submitting && "gap-1.5")}
              >
                {submitting ? <LoaderIcon className="size-3.5 animate-spin" /> : null}
                {submitting ? "Starting" : "Ask Advisor"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
