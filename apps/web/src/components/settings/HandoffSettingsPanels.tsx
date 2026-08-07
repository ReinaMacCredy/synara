import {
  PROVIDER_DISPLAY_NAMES,
  type HandoffConversationMode,
  type HandoffAgentSettings,
  type HandoffSourceReadGrant,
  type ProviderKind,
  type ServerSettings,
  type ThreadId,
} from "@synara/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { Button } from "~/components/ui/button";
import { SelectItem } from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useProviderModelCatalog } from "~/hooks/useProviderModelCatalog";
import { serverQueryKeys, serverSettingsQueryOptions } from "~/lib/serverReactQuery";
import { ensureNativeApi } from "~/nativeApi";
import { useStore } from "~/store";
import { createThreadShellsSelector } from "~/storeSelectors";
import type { ThreadShell } from "~/types";
import { resolveHandoffSettingsModel } from "./handoffSettingsModel";
import { SettingsSelectControl } from "./SettingControls";
import {
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

const HANDOFF_PROVIDERS = Object.keys(PROVIDER_DISPLAY_NAMES) as ReadonlyArray<ProviderKind>;
const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh"] as const;

function runtimeLabel(settings: HandoffAgentSettings) {
  return `${PROVIDER_DISPLAY_NAMES[settings.provider]} · ${settings.model} · ${settings.effort}`;
}

export function HandoffAgentSettingsPanel({ active }: { active: boolean }) {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    ...serverSettingsQueryOptions(),
    enabled: active,
  });
  const committed = settingsQuery.data?.handoffAgent;
  const [draft, setDraft] = useState<HandoffAgentSettings | null>(null);
  const [modelByProvider, setModelByProvider] = useState<Partial<Record<ProviderKind, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (committed) {
      setDraft(committed);
      setModelByProvider({ [committed.provider]: committed.model });
    }
  }, [committed]);

  const selectedProvider = draft?.provider ?? committed?.provider ?? "codex";
  const selectedModel = draft?.model ?? committed?.model ?? null;
  const modelHintByProvider = useMemo(
    () => ({ [selectedProvider]: selectedModel }),
    [selectedModel, selectedProvider],
  );
  const { modelOptionsByProvider } = useProviderModelCatalog({
    selectedProvider,
    discoveryEnabled: active,
    modelHintByProvider,
    prefetchProviders: [selectedProvider],
  });

  if (!active) return null;
  if (!draft) {
    return <SettingsEmptyState layout="status">Loading Handoff Agent settings…</SettingsEmptyState>;
  }

  const save = async () => {
    setSaving(true);
    try {
      const next = await ensureNativeApi().server.updateSettings({ handoffAgent: draft });
      queryClient.setQueryData<ServerSettings>(serverQueryKeys.settings(), next);
      toastManager.add({
        type: "success",
        title: "Handoff Agent updated",
        description: runtimeLabel(next.handoffAgent),
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to update Handoff Agent",
        description: error instanceof Error ? error.message : String(error),
      });
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.settings() });
    } finally {
      setSaving(false);
    }
  };

  const changed = committed !== undefined && JSON.stringify(committed) !== JSON.stringify(draft);
  const modelOptions = modelOptionsByProvider[draft.provider];
  const selectedModelLabel =
    modelOptions.find((option) => option.slug === draft.model)?.name ?? draft.model;
  return (
    <div className="space-y-8">
      <SettingsSection title="Handoff runtime">
        <SettingsRow
          title="Provider"
          description="The one-shot agent that prepares cited handoff packets. Unsupported providers fail visibly; Synara never reroutes silently."
          status={
            draft.provider === "codex"
              ? "Provider-native dynamic tools supported"
              : "Native handoff tools are not yet supported"
          }
          control={
            <SettingsSelectControl
              value={draft.provider}
              onValueChange={(value) => {
                const provider = value as ProviderKind;
                setModelByProvider((remembered) => ({
                  ...remembered,
                  [draft.provider]: draft.model,
                }));
                setDraft({
                  ...draft,
                  provider,
                  model: resolveHandoffSettingsModel({
                    provider,
                    rememberedModel: modelByProvider[provider],
                    options: modelOptionsByProvider[provider],
                  }),
                });
              }}
              ariaLabel="Handoff Agent provider"
              valueContent={
                <span className="flex items-center gap-2">
                  <ProviderIcon provider={draft.provider} className="size-4" />
                  {PROVIDER_DISPLAY_NAMES[draft.provider]}
                </span>
              }
            >
              {HANDOFF_PROVIDERS.map((provider) => (
                <SelectItem key={provider} value={provider}>
                  <span className="flex items-center gap-2">
                    <ProviderIcon provider={provider} className="size-4" />
                    {PROVIDER_DISPLAY_NAMES[provider]}
                  </span>
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
        <SettingsRow
          title="Model"
          description="Provider model used only for handoff preparation."
          control={
            <SettingsSelectControl
              value={draft.model}
              onValueChange={(model) => {
                setDraft((current) => current && { ...current, model });
                setModelByProvider((remembered) => ({
                  ...remembered,
                  [draft.provider]: model,
                }));
              }}
              ariaLabel="Handoff Agent model"
              triggerClassName="w-full sm:w-56"
              valueContent={selectedModelLabel}
            >
              {modelOptions.map((option) => (
                <SelectItem hideIndicator key={option.slug} value={option.slug}>
                  {option.name}
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
        <SettingsRow
          title="Reasoning effort"
          description="Frozen with each preparation attempt for reproducibility."
          control={
            <SettingsSelectControl
              value={draft.effort}
              onValueChange={(effort) => setDraft((current) => current && { ...current, effort })}
              ariaLabel="Handoff Agent reasoning effort"
              valueContent={<span className="capitalize">{draft.effort}</span>}
            >
              {EFFORT_OPTIONS.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  <span className="capitalize">{effort}</span>
                </SelectItem>
              ))}
            </SettingsSelectControl>
          }
        />
      </SettingsSection>

      <SettingsSectionShell title="Instruction">
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="space-y-2 text-sm">
            <span className="font-medium">Custom guidance</span>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Added after Synara's versioned core handoff instruction and before the one-time
              handoff prompt.
            </p>
            <Textarea
              value={draft.customGuidance}
              onChange={(event) =>
                setDraft((current) => current && { ...current, customGuidance: event.target.value })
              }
              placeholder="Additional guidance for every handoff packet"
              className="min-h-32 resize-y"
            />
          </label>
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              disabled={!changed || saving}
              onClick={() => committed && setDraft(committed)}
            >
              Discard
            </Button>
            <Button
              disabled={!changed || saving || !draft.model.trim()}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save Handoff Agent"}
            </Button>
          </div>
        </div>
      </SettingsSectionShell>
    </div>
  );
}

function grantStatus(grant: HandoffSourceReadGrant) {
  return `${grant.status} · revision ${grant.revision} · cursor ${grant.grantedThroughCursor}`;
}

const handoffModeLabel = (mode: HandoffConversationMode | undefined) => {
  if (mode === "orchestrator_root") return "Supervised Lead Room";
  if (mode === "orchestrator_child") return "Supervised Specialist";
  return "Projects";
};

function rootThreadIdFor(
  threadId: ThreadId,
  threadById: ReadonlyMap<ThreadId, ThreadShell>,
): ThreadId {
  let current = threadById.get(threadId);
  const visited = new Set<ThreadId>();
  while (current?.parentThreadId && !visited.has(current.parentThreadId)) {
    visited.add(current.id);
    current = threadById.get(current.parentThreadId);
  }
  return current?.id ?? threadId;
}

export function HandoffAccessSettingsPanel({ active }: { active: boolean }) {
  const navigate = useNavigate();
  const threadShells = useStore(useMemo(() => createThreadShellsSelector(), []));
  const threadById = useMemo(
    () => new Map(threadShells.map((thread) => [thread.id, thread] as const)),
    [threadShells],
  );
  const grantsQuery = useQuery({
    queryKey: ["handoff", "grants"],
    queryFn: () => ensureNativeApi().orchestration.listHandoffGrants(),
    enabled: active,
  });

  if (!active) return null;
  const grants = grantsQuery.data?.items ?? [];
  const revoke = async (grant: HandoffSourceReadGrant) => {
    const confirmed = await ensureNativeApi().dialogs.confirm(
      "Revoke source access?\nFuture agent reads from this handoff source will stop immediately.",
    );
    if (!confirmed) return;
    await ensureNativeApi().orchestration.revokeHandoffGrant({ grantId: grant.grantId });
    await grantsQuery.refetch();
  };
  const openThread = async (threadId: ThreadId, mode: HandoffConversationMode | undefined) => {
    if (mode === "orchestrator_root" || mode === "orchestrator_child") {
      await navigate({
        to: "/supervised/$roomId",
        params: { roomId: rootThreadIdFor(threadId, threadById) },
      });
      return;
    }
    await navigate({ to: "/$threadId", params: { threadId } });
  };

  return (
    <SettingsSectionShell title="Source-read grants">
      {grantsQuery.isLoading ? (
        <SettingsEmptyState layout="status">Loading handoff access…</SettingsEmptyState>
      ) : grants.length === 0 ? (
        <SettingsEmptyState>No handoff source access has been created yet.</SettingsEmptyState>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {grants.map((grant) => {
            const source = threadById.get(grant.sourceThreadId);
            const destination = threadById.get(grant.destinationThreadId);
            const accepted = destination?.handoff?.crossMode;
            const sourceMode = accepted?.sourceMode;
            const destinationMode = accepted?.destinationMode;
            return (
              <SettingsListRow
                key={grant.grantId}
                title={`${source?.title ?? accepted?.sourceTitle ?? "Source thread"} → ${destination?.title ?? "Destination thread"}`}
                description={`${handoffModeLabel(sourceMode)} → ${handoffModeLabel(destinationMode)} · ${grantStatus(grant)}`}
                actions={
                  <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openThread(grant.sourceThreadId, sourceMode)}
                    >
                      Open source
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openThread(grant.destinationThreadId, destinationMode)}
                    >
                      Open destination
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={grant.status === "revoked"}
                      onClick={() => void revoke(grant)}
                    >
                      Revoke
                    </Button>
                  </div>
                }
              />
            );
          })}
        </div>
      )}
    </SettingsSectionShell>
  );
}
