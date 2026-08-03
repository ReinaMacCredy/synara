import {
  type HandoffRuntimeSelection,
  type ModelSlug,
  type ThreadId,
} from "@synara/contracts";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { Button } from "../ui/button";
import { serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ComposerModelEffortPicker } from "./ComposerModelEffortPicker";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

export function CrossModeHandoffDialog(props: {
  readonly open: boolean;
  readonly threadId: ThreadId;
  readonly destinationLabel: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onContinue: (prompt: string, runtime: HandoffRuntimeSelection) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelSlug | null>(null);
  const [selectedEffort, setSelectedEffort] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsQuery = useQuery(serverSettingsQueryOptions());
  const runtime = settingsQuery.data?.handoffAgent;
  const selectedProvider = runtime?.provider ?? "codex";
  const modelHintByProvider = useMemo(
    () => ({ [selectedProvider]: selectedModel ?? runtime?.model ?? null }),
    [runtime?.model, selectedModel, selectedProvider],
  );
  const { modelOptionsByProvider, loadingModelProviders, runtimeModelsByProvider } =
    useProviderModelCatalog({
      selectedProvider,
      discoveryEnabled: props.open,
      modelHintByProvider,
      prefetchProviders: [selectedProvider],
    });
  const effectiveModel = selectedModel ?? runtime?.model ?? null;
  const effectiveEffort = selectedEffort ?? runtime?.effort ?? null;
  const runtimeModel = runtimeModelsByProvider[selectedProvider].find(
    (candidate) => candidate.slug === effectiveModel,
  );

  useEffect(() => {
    if (props.open && runtime) {
      setSelectedModel(runtime.model);
      setSelectedEffort(runtime.effort);
    }
  }, [props.open, runtime]);

  const submit = async () => {
    if (!runtime || !effectiveModel || !effectiveEffort) {
      setError("Handoff Agent settings are still loading.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.onContinue(prompt, {
        provider: runtime.provider,
        model: effectiveModel,
        effort: effectiveEffort,
      });
      props.onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Continue in {props.destinationLabel}</DialogTitle>
          <DialogDescription>
            Synara opens the destination immediately while the configured one-shot agent prepares a
            cited packet.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="space-y-2 text-sm">
            <span className="font-medium">Handoff prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="What should the handoff agent preserve or emphasize?"
              className="min-h-28 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Sent with the sealed source context to the Handoff Agent. It is not sent as your first
            destination message.
          </p>
          {runtime && effectiveModel && effectiveEffort ? (
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ComposerModelEffortPicker
                provider={runtime.provider}
                model={effectiveModel}
                lockedProvider={runtime.provider}
                modelOptionsByProvider={modelOptionsByProvider}
                loadingModelProviders={loadingModelProviders}
                threadId={props.threadId}
                runtimeModel={runtimeModel}
                modelOptions={undefined}
                prompt=""
                onPromptChange={() => undefined}
                controlledEffort={{
                  value: effectiveEffort,
                  onValueChange: setSelectedEffort,
                }}
                disabled={busy}
                onProviderModelChange={(_provider, model) => setSelectedModel(model)}
              />
              {runtime.customGuidance.trim() ? (
                <span>Global guidance applies</span>
              ) : null}
              {loadingModelProviders[selectedProvider] ? (
                <span className="sr-only">Loading live models</span>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Loading configured Handoff Agent…
            </p>
          )}
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !runtime || !effectiveModel || !effectiveEffort}
          >
            {busy ? "Preparing…" : `Continue in ${props.destinationLabel}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
