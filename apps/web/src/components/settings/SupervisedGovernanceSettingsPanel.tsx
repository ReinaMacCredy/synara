import {
  UserModelPreferenceProfile,
  UserModelPreferenceProfileId,
  type ModelCapabilityProfileId,
  type SupervisorNotebookEntry,
  type SupervisedSettingsSnapshot,
  type SupervisedSystemTool,
  type SupervisedToolPolicyState,
  type UserModelPreferenceProfile as UserModelPreferenceProfileType,
} from "@veylen/contracts";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { supervisedSettingsQueryOptions } from "~/lib/supervisedSettings";
import { readNativeApi } from "~/nativeApi";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

export type SupervisedGovernanceSettingsSurface =
  | "general"
  | "models"
  | "notebook"
  | "authority"
  | "lifecycle"
  | "tools";

const SELECT_CLASS_NAME =
  "h-9 w-full rounded-lg border border-border bg-transparent px-3 text-xs text-foreground";

const statusValue = (text: string) => (
  <span className="text-xs tabular-nums text-foreground/80">{text}</span>
);

const formatTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Not recorded";

export const supervisorNotebookEntryByline = (entry: SupervisorNotebookEntry) =>
  `${entry.roomId ? `Room ${entry.roomId}` : `Workspace ${entry.workspaceId}`} · author ${entry.authorSeatId} · confidence ${Math.round(entry.confidence * 100)}%`;

const summarizeScopeIds = (label: string, values: ReadonlyArray<string>) =>
  values.length === 0
    ? null
    : `${label} ${values.slice(0, 3).join(", ")}${values.length > 3 ? ` +${values.length - 3}` : ""}`;

const emptyPreference = (): UserModelPreferenceProfileType => ({
  id: UserModelPreferenceProfileId.makeUnsafe(crypto.randomUUID()),
  userId: "owner",
  revision: 0,
  ratings: {},
  relativePreferences: [],
  preferredFor: {},
  avoidFor: {},
  priorities: { quality: 10, speed: 5, cost: 5, contextCapacity: 5 },
  defaultModels: {},
  fallbackChains: {},
  ownerNotes: "",
  updatedAt: new Date().toISOString(),
});

const activeOwnerPreference = (snapshot: SupervisedSettingsSnapshot) =>
  snapshot.governance.userModelPreferenceProfiles.find((profile) => profile.userId === "owner") ??
  null;

function GeneralPanel({ snapshot }: { readonly snapshot: SupervisedSettingsSnapshot }) {
  const { governance, runtime } = snapshot;
  const primarySupervisor = governance.agentSeats.find(
    (seat) =>
      seat.identityRole === "supervisor" &&
      ["ready", "active", "recovering"].includes(seat.lifecycleState),
  );
  const attentionSignals = runtime.signals.filter((signal) => signal.state === "triggered");
  const activeRooms = runtime.rooms.filter(
    (room) => !["completed", "archived", "failed"].includes(room.status),
  );
  const activeTasks = runtime.taskNodes.filter((task) =>
    ["ready", "claimed", "running", "waiting", "review"].includes(task.lifecycle),
  );

  return (
    <div className="space-y-8">
      <SettingsSection title="Owner control plane">
        <SettingsRow
          title="Primary Supervisor"
          description="The default owner-facing seat for Supervised messages and cross-Room coordination."
          control={statusValue(
            primarySupervisor
              ? `${primarySupervisor.lifecycleState} · ${primarySupervisor.workState}`
              : "Not provisioned",
          )}
        />
        <SettingsRow
          title="Durable governance"
          description="Canonical authority, notebook, model-routing, and lifecycle state loaded from local storage."
          control={statusValue(`revision ${governance.revision}`)}
        />
        <SettingsRow
          title="Runtime daemon"
          description="Background reconciliation, Signal delivery, programmable kernels, and recovery."
          control={statusValue(`${runtime.health.status} · epoch ${runtime.health.daemonEpoch}`)}
        />
      </SettingsSection>

      <SettingsSection title="Workspace status">
        <SettingsRow
          title="Active Rooms"
          description="Rooms currently creating, ready, active, paused, draining, degraded, or recovering."
          control={statusValue(String(activeRooms.length))}
        />
        <SettingsRow
          title="Open task nodes"
          description="Real durable tasks that can still be claimed, run, reviewed, or unblocked."
          control={statusValue(String(activeTasks.length))}
        />
        <SettingsRow
          title="Signals requiring attention"
          description="Triggered durable Signals only; acknowledged, reset, expired, and high-frequency telemetry are excluded."
          control={statusValue(String(attentionSignals.length))}
        />
      </SettingsSection>

      <SettingsSectionShell title="Attention queue">
        {attentionSignals.length === 0 ? (
          <SettingsEmptyState layout="status">
            No durable Signals currently require owner attention.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {attentionSignals.slice(0, 20).map((signal) => (
              <SettingsListRow
                key={signal.id}
                title={`${signal.kind} · ${signal.state}`}
                description={`${signal.id} · triggered ${formatTime(signal.triggeredAt)}`}
                actions={statusValue(`value ${signal.measuredValue}`)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>
    </div>
  );
}

const MODEL_TABS = [
  "Catalog",
  "My preferences",
  "Routing rules",
  "Defaults & fallbacks",
  "Selection history",
] as const;
type ModelTab = (typeof MODEL_TABS)[number];

function ModelsPanel({
  snapshot,
  refetch,
}: {
  readonly snapshot: SupervisedSettingsSnapshot;
  readonly refetch: () => Promise<unknown>;
}) {
  const profiles = snapshot.governance.modelCapabilityProfiles;
  const persisted = activeOwnerPreference(snapshot);
  const [tab, setTab] = useState<ModelTab>("Catalog");
  const [draft, setDraft] = useState<UserModelPreferenceProfileType | null>(persisted);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [relativeCategory, setRelativeCategory] = useState("implementation");
  const [relativePreferred, setRelativePreferred] = useState("");
  const [relativeOver, setRelativeOver] = useState("");
  const [relativeReason, setRelativeReason] = useState("");
  const [ruleCategory, setRuleCategory] = useState("implementation");
  const [ruleModel, setRuleModel] = useState("");
  const [ruleMode, setRuleMode] = useState<"preferred" | "avoid">("preferred");
  const [fallbackCategory, setFallbackCategory] = useState("implementation");
  const [fallbackModel, setFallbackModel] = useState("");
  const [draggedFallback, setDraggedFallback] = useState<{
    readonly category: string;
    readonly index: number;
  } | null>(null);

  useEffect(() => {
    if (persisted) {
      setDraft((current) =>
        current?.id === persisted.id && current.revision === persisted.revision
          ? current
          : persisted,
      );
      return;
    }
    setDraft((current) => current ?? emptyPreference());
  }, [persisted?.id, persisted?.revision]);

  const updateDraft = (
    update: (current: UserModelPreferenceProfileType) => UserModelPreferenceProfileType,
  ) => setDraft((current) => update(current ?? emptyPreference()));

  const save = async () => {
    const api = readNativeApi();
    if (!api || !draft) return;
    setBusy(true);
    setFeedback(null);
    try {
      const current = activeOwnerPreference(snapshot);
      const next: UserModelPreferenceProfileType = {
        ...draft,
        id: current?.id ?? draft.id,
        userId: "owner",
        revision: current ? current.revision + 1 : 0,
        updatedAt: new Date().toISOString(),
      };
      const result = await api.orchestration.putSupervisedModelPreferences({
        profile: next,
        expectedRevision: current?.revision ?? null,
      });
      setDraft(result.profile);
      await refetch();
      setFeedback(
        `Saved preference revision ${result.profile.revision}. The next recommendation reads routing revision ${result.routingRevision}.`,
      );
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const exportPreferences = () => {
    if (!draft) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "supervised-model-preferences.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importPreferences = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = Schema.decodeUnknownSync(UserModelPreferenceProfile)(
        JSON.parse(await file.text()),
      );
      const current = draft ?? emptyPreference();
      setDraft({
        ...imported,
        id: current.id,
        userId: "owner",
        revision: current.revision,
        updatedAt: current.updatedAt,
      });
      setFeedback("Imported into the unsaved owner preference draft.");
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : "Invalid preference file.");
    }
  };

  const modelName = (id: string) => profiles.find((profile) => profile.id === id)?.model ?? id;
  const draftReady = draft ?? emptyPreference();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 border-b border-border/55 pb-4">
        {MODEL_TABS.map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={tab === candidate ? "default" : "ghost"}
            onClick={() => setTab(candidate)}
          >
            {candidate}
          </Button>
        ))}
      </div>

      {tab === "Catalog" ? (
        <SettingsSectionShell title="Governed model catalog">
          {profiles.length === 0 ? (
            <SettingsEmptyState>
              No durable capability profiles have been recorded. Veylen will not invent ratings or
              routing candidates.
            </SettingsEmptyState>
          ) : (
            <SettingsCard>
              {profiles.map((profile) => (
                <SettingsListRow
                  key={profile.id}
                  align="start"
                  title={`${profile.model} · ${profile.version}`}
                  description={
                    <span>
                      {profile.provider} · context {profile.contextCapacity.toLocaleString()} ·
                      coding {profile.scores.coding}/10 · architecture {profile.scores.architecture}
                      /10 · review {profile.scores.review}/10 · confidence{" "}
                      {Math.round(profile.confidence * 100)}%
                      <br />
                      provenance: {profile.provenance.join(", ")}
                    </span>
                  }
                  actions={statusValue(profile.available ? "available" : "unavailable")}
                />
              ))}
            </SettingsCard>
          )}
        </SettingsSectionShell>
      ) : null}

      {tab === "My preferences" ? (
        <div className="space-y-8">
          <SettingsSectionShell
            title="Personal ratings"
            action={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDraft(emptyPreference())}>
                  Reset draft
                </Button>
                <Button size="sm" variant="outline" onClick={exportPreferences}>
                  Export
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border px-3 text-xs font-medium">
                  Import
                  <input
                    className="sr-only"
                    type="file"
                    accept="application/json"
                    onChange={(event) => void importPreferences(event.target.files?.[0])}
                  />
                </label>
                <Button size="sm" disabled={busy} onClick={() => void save()}>
                  {busy ? "Saving…" : "Save preferences"}
                </Button>
              </div>
            }
          >
            {profiles.length === 0 ? (
              <SettingsEmptyState layout="status">
                Ratings become editable when real capability profiles exist.
              </SettingsEmptyState>
            ) : (
              <SettingsCard>
                {profiles.map((profile) => (
                  <SettingsRow
                    key={profile.id}
                    title={profile.model}
                    description={`${profile.provider} · ${profile.version}`}
                    control={
                      <div className="flex items-center gap-2">
                        <Input
                          className="w-20"
                          aria-label={`Rating for ${profile.model}`}
                          type="number"
                          min={0}
                          max={10}
                          step={1}
                          value={draftReady.ratings[profile.id] ?? ""}
                          onChange={(event) => {
                            const parsed = Number(event.target.value);
                            updateDraft((current) => ({
                              ...current,
                              ratings: {
                                ...current.ratings,
                                ...(Number.isFinite(parsed)
                                  ? { [profile.id]: Math.max(0, Math.min(10, parsed)) }
                                  : {}),
                              },
                            }));
                          }}
                        />
                        <span className="text-xs text-muted-foreground">/ 10</span>
                      </div>
                    }
                  />
                ))}
              </SettingsCard>
            )}
          </SettingsSectionShell>

          <SettingsSectionShell title="Routing priorities">
            <SettingsCard>
              {(["quality", "speed", "cost", "contextCapacity"] as const).map((priority) => (
                <SettingsRow
                  key={priority}
                  title={
                    priority === "contextCapacity"
                      ? "Context capacity"
                      : priority[0]!.toUpperCase() + priority.slice(1)
                  }
                  description="Relative owner priority used by the durable model-routing scorer."
                  control={
                    <Input
                      className="w-20"
                      type="number"
                      min={0}
                      max={10}
                      value={draftReady.priorities[priority]}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          priorities: {
                            ...current.priorities,
                            [priority]: Math.max(0, Math.min(10, Number(event.target.value) || 0)),
                          },
                        }))
                      }
                    />
                  }
                />
              ))}
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSectionShell title="Owner notes">
            <Textarea
              aria-label="Owner model preference notes"
              maxLength={32_768}
              value={draftReady.ownerNotes ?? ""}
              placeholder="Record durable context for future model-routing decisions."
              onChange={(event) =>
                updateDraft((current) => ({ ...current, ownerNotes: event.target.value }))
              }
            />
          </SettingsSectionShell>
        </div>
      ) : null}

      {tab === "Routing rules" ? (
        <div className="space-y-8">
          <SettingsSectionShell title="Relative preference">
            <SettingsCard divided={false}>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Input
                  value={relativeCategory}
                  onChange={(event) => setRelativeCategory(event.target.value)}
                  placeholder="Task category"
                />
                <Input
                  value={relativeReason}
                  onChange={(event) => setRelativeReason(event.target.value)}
                  placeholder="Reason (optional)"
                />
                <select
                  className={SELECT_CLASS_NAME}
                  value={relativePreferred}
                  onChange={(event) => setRelativePreferred(event.target.value)}
                >
                  <option value="">Preferred model…</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.model}
                    </option>
                  ))}
                </select>
                <select
                  className={SELECT_CLASS_NAME}
                  value={relativeOver}
                  onChange={(event) => setRelativeOver(event.target.value)}
                >
                  <option value="">Over model…</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.model}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={
                    !relativeCategory.trim() ||
                    !relativePreferred ||
                    !relativeOver ||
                    relativePreferred === relativeOver
                  }
                  onClick={() => {
                    updateDraft((current) => ({
                      ...current,
                      relativePreferences: [
                        ...current.relativePreferences,
                        {
                          preferredModelId: relativePreferred as ModelCapabilityProfileId,
                          overModelId: relativeOver as ModelCapabilityProfileId,
                          category: relativeCategory.trim(),
                          reason: relativeReason.trim() || null,
                        },
                      ],
                    }));
                    setRelativeReason("");
                  }}
                >
                  Add preference
                </Button>
              </div>
              {draftReady.relativePreferences.map((preference, index) => (
                <SettingsListRow
                  key={`${preference.category}-${preference.preferredModelId}-${preference.overModelId}-${index}`}
                  title={`${modelName(preference.preferredModelId)} over ${modelName(preference.overModelId)}`}
                  description={`${preference.category}${preference.reason ? ` · ${preference.reason}` : ""}`}
                  actions={
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        updateDraft((current) => ({
                          ...current,
                          relativePreferences: current.relativePreferences.filter(
                            (_, candidate) => candidate !== index,
                          ),
                        }))
                      }
                    >
                      Remove
                    </Button>
                  }
                />
              ))}
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSectionShell title="Preferred and avoid categories">
            <SettingsCard divided={false}>
              <div className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input
                  value={ruleCategory}
                  onChange={(event) => setRuleCategory(event.target.value)}
                  placeholder="Task category"
                />
                <select
                  className={SELECT_CLASS_NAME}
                  value={ruleModel}
                  onChange={(event) => setRuleModel(event.target.value)}
                >
                  <option value="">Model…</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.model}
                    </option>
                  ))}
                </select>
                <select
                  className={SELECT_CLASS_NAME}
                  value={ruleMode}
                  onChange={(event) => setRuleMode(event.target.value as typeof ruleMode)}
                >
                  <option value="preferred">Preferred</option>
                  <option value="avoid">Avoid</option>
                </select>
                <Button
                  size="sm"
                  disabled={!ruleCategory.trim() || !ruleModel}
                  onClick={() =>
                    updateDraft((current) => {
                      const target =
                        ruleMode === "preferred" ? current.preferredFor : current.avoidFor;
                      const existing = target[ruleCategory.trim()] ?? [];
                      return {
                        ...current,
                        [ruleMode === "preferred" ? "preferredFor" : "avoidFor"]: {
                          ...target,
                          [ruleCategory.trim()]: [
                            ...new Set([...existing, ruleModel as ModelCapabilityProfileId]),
                          ],
                        },
                      };
                    })
                  }
                >
                  Add rule
                </Button>
              </div>
              {(["preferred", "avoid"] as const).flatMap((mode) =>
                Object.entries(
                  mode === "preferred" ? draftReady.preferredFor : draftReady.avoidFor,
                ).flatMap(([category, ids]) =>
                  ids.map((id) => (
                    <SettingsListRow
                      key={`${mode}-${category}-${id}`}
                      title={`${mode === "preferred" ? "Prefer" : "Avoid"} ${modelName(id)}`}
                      description={category}
                      actions={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateDraft((current) => {
                              const key = mode === "preferred" ? "preferredFor" : "avoidFor";
                              const target = current[key];
                              return {
                                ...current,
                                [key]: {
                                  ...target,
                                  [category]: (target[category] ?? []).filter(
                                    (candidate) => candidate !== id,
                                  ),
                                },
                              };
                            })
                          }
                        >
                          Remove
                        </Button>
                      }
                    />
                  )),
                ),
              )}
            </SettingsCard>
          </SettingsSectionShell>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save routing rules"}
          </Button>
        </div>
      ) : null}

      {tab === "Defaults & fallbacks" ? (
        <div className="space-y-8">
          <SettingsSection title="Per-role defaults">
            {(["supervisor", "lead", "peer", "reviewer", "rlmBranch"] as const).map((role) => (
              <SettingsRow
                key={role}
                title={role === "rlmBranch" ? "RLM branch" : role[0]!.toUpperCase() + role.slice(1)}
                description="Preferred default; hard constraints and availability still win."
                control={
                  <select
                    className={`${SELECT_CLASS_NAME} sm:w-56`}
                    value={draftReady.defaultModels[role] ?? ""}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        defaultModels: {
                          ...current.defaultModels,
                          [role]: event.target.value || undefined,
                        },
                      }))
                    }
                  >
                    <option value="">No default</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.model}
                      </option>
                    ))}
                  </select>
                }
              />
            ))}
          </SettingsSection>

          <SettingsSectionShell title="Fallback chains">
            <SettingsCard divided={false}>
              <div className="grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={fallbackCategory}
                  onChange={(event) => setFallbackCategory(event.target.value)}
                  placeholder="Task category"
                />
                <select
                  className={SELECT_CLASS_NAME}
                  value={fallbackModel}
                  onChange={(event) => setFallbackModel(event.target.value)}
                >
                  <option value="">Model…</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.model}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!fallbackCategory.trim() || !fallbackModel}
                  onClick={() =>
                    updateDraft((current) => {
                      const category = fallbackCategory.trim();
                      const chain = current.fallbackChains[category] ?? [];
                      return {
                        ...current,
                        fallbackChains: {
                          ...current.fallbackChains,
                          [category]: [
                            ...new Set([...chain, fallbackModel as ModelCapabilityProfileId]),
                          ],
                        },
                      };
                    })
                  }
                >
                  Add fallback
                </Button>
              </div>
              {Object.entries(draftReady.fallbackChains).flatMap(([category, ids]) =>
                ids.map((id, index) => (
                  <div
                    key={`${category}-${id}`}
                    draggable
                    onDragStart={() => setDraggedFallback({ category, index })}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (
                        draggedFallback === null ||
                        draggedFallback.category !== category ||
                        draggedFallback.index === index
                      ) {
                        setDraggedFallback(null);
                        return;
                      }
                      updateDraft((current) => {
                        const chain = [...(current.fallbackChains[category] ?? [])];
                        const [moved] = chain.splice(draggedFallback.index, 1);
                        if (moved) chain.splice(index, 0, moved);
                        return {
                          ...current,
                          fallbackChains: { ...current.fallbackChains, [category]: chain },
                        };
                      });
                      setDraggedFallback(null);
                    }}
                  >
                    <SettingsListRow
                      title={`${index + 1}. ${modelName(id)}`}
                      description={`${category} · drag to reorder`}
                      actions={
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              fallbackChains: {
                                ...current.fallbackChains,
                                [category]: (current.fallbackChains[category] ?? []).filter(
                                  (candidate) => candidate !== id,
                                ),
                              },
                            }))
                          }
                        >
                          Remove
                        </Button>
                      }
                    />
                  </div>
                )),
              )}
            </SettingsCard>
          </SettingsSectionShell>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save defaults & fallbacks"}
          </Button>
        </div>
      ) : null}

      {tab === "Selection history" ? (
        <SettingsSectionShell title="Why this model was selected">
          {snapshot.governance.modelSelectionReceipts.length === 0 ? (
            <SettingsEmptyState>
              No durable selection receipt exists yet. Veylen will show explanations only after a
              real routing decision.
            </SettingsEmptyState>
          ) : (
            <SettingsCard>
              {[...snapshot.governance.modelSelectionReceipts]
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
                .slice(0, 50)
                .map((receipt) => (
                  <SettingsListRow
                    key={receipt.id}
                    align="start"
                    title={modelName(receipt.selectedModelId)}
                    description={
                      <span>
                        {receipt.explanation}
                        <br />
                        {(receipt.rankedCandidates ?? [])
                          .slice(0, 3)
                          .map(
                            (candidate) =>
                              `${candidate.rank}. ${modelName(candidate.modelId)} (${candidate.totalScore})`,
                          )
                          .join(" · ")}
                        <br />
                        {formatTime(receipt.createdAt)} · routing revision {receipt.routingRevision}
                      </span>
                    }
                    actions={statusValue(receipt.overrideReason ? "owner override" : "automatic")}
                  />
                ))}
            </SettingsCard>
          )}
        </SettingsSectionShell>
      ) : null}

      <div className="min-h-5 text-[11px] text-muted-foreground" aria-live="polite">
        {feedback}
      </div>
    </div>
  );
}

function NotebookPanel({ snapshot }: { readonly snapshot: SupervisedSettingsSnapshot }) {
  const [search, setSearch] = useState("");
  const [concern, setConcern] = useState("all");
  const [scope, setScope] = useState("all");
  const notebookCompactionReceipts = snapshot.governance.notebookCompactionReceipts ?? [];
  const notebookCursors = snapshot.governance.notebookCursors ?? [];
  const concerns = [...new Set(snapshot.governance.notebookEntries.map((entry) => entry.concern))];
  const scopes = [
    ...new Set(
      snapshot.governance.notebookEntries.map((entry) => entry.roomId ?? entry.workspaceId),
    ),
  ];
  const entries = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase();
    return snapshot.governance.notebookEntries.filter((entry) => {
      if (concern !== "all" && entry.concern !== concern) return false;
      if (scope !== "all" && entry.roomId !== scope && entry.workspaceId !== scope) return false;
      if (!normalized) return true;
      return `${entry.kind} ${entry.concern} ${entry.content} ${entry.evidenceRefs.join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [concern, scope, search, snapshot.governance.notebookEntries]);
  const promotions = entries.filter(
    (entry) =>
      !entry.redactedAt && entry.confidence >= 0.8 && ["lesson", "decision"].includes(entry.kind),
  );

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px_180px]">
        <Input
          aria-label="Search shared notebook"
          placeholder="Search content or evidence…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          aria-label="Notebook concern"
          className={SELECT_CLASS_NAME}
          value={concern}
          onChange={(event) => setConcern(event.target.value)}
        >
          <option value="all">All concerns</option>
          {concerns.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Notebook scope"
          className={SELECT_CLASS_NAME}
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="all">All scopes</option>
          {scopes.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <SettingsSectionShell title="Durable entries">
        {entries.length === 0 ? (
          <SettingsEmptyState>
            {snapshot.governance.notebookEntries.length === 0
              ? "No durable notebook entries exist yet."
              : "No notebook entry matches these filters."}
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {entries.slice(0, 100).map((entry) => (
              <SettingsListRow
                key={entry.id}
                align="start"
                title={`${entry.kind} · ${entry.concern}`}
                description={
                  <span>
                    {entry.redactedAt ? "[Redacted]" : entry.content}
                    <br />
                    {supervisorNotebookEntryByline(entry)}
                    <br />
                    evidence: {entry.evidenceRefs.slice(0, 5).join(", ") || "none"}
                    {entry.evidenceRefs.length > 5
                      ? ` · +${entry.evidenceRefs.length - 5} more`
                      : ""}
                    {entry.supersedesEntryId ? ` · supersedes ${entry.supersedesEntryId}` : ""}
                  </span>
                }
                actions={statusValue(entry.redactedAt ? "redacted" : formatTime(entry.createdAt))}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSectionShell title="Compaction status">
        {notebookCompactionReceipts.length === 0 ? (
          <SettingsEmptyState layout="status">
            No notebook compaction receipt exists.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {notebookCompactionReceipts.map((receipt) => (
              <SettingsListRow
                key={receipt.id}
                title={`Summary ${receipt.summaryEntryId}`}
                description={`${receipt.sourceEntryIds.length} source entries · evidence ${receipt.evidenceRefs.slice(0, 5).join(", ") || "none"}`}
                actions={statusValue(formatTime(receipt.createdAt))}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSectionShell title="Per-seat cursors">
        {notebookCursors.length === 0 ? (
          <SettingsEmptyState layout="status">
            No AgentSeat has advanced a notebook cursor.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {notebookCursors.map((cursor) => (
              <SettingsListRow
                key={cursor.id}
                title={`Seat ${cursor.seatId}`}
                description={`Workspace ${cursor.workspaceId} · last entry ${cursor.lastEntryId ?? "none"}`}
                actions={statusValue(formatTime(cursor.lastCreatedAt ?? cursor.updatedAt))}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSection title="Supersession history">
        <SettingsRow
          title="Supersession links"
          description="History remains visible when a newer entry supersedes an earlier entry."
          control={statusValue(
            String(
              snapshot.governance.notebookEntries.filter((entry) => entry.supersedesEntryId).length,
            ),
          )}
        />
      </SettingsSection>

      <SettingsSectionShell title="Promotion candidates">
        {promotions.length === 0 ? (
          <SettingsEmptyState layout="status">
            No high-confidence lesson or decision is currently eligible for promotion.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {promotions.map((entry) => (
              <SettingsListRow
                key={entry.id}
                title={entry.concern}
                description={entry.content}
                actions={statusValue(`${Math.round(entry.confidence * 100)}%`)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>
    </div>
  );
}

function AuthorityPanel({ snapshot }: { readonly snapshot: SupervisedSettingsSnapshot }) {
  const governance = snapshot.governance;
  const runtimeAudit = snapshot.runtime.audit ?? [];
  const [receiptId, setReceiptId] = useState(governance.authorityReceipts[0]?.id ?? "");
  const [command, setCommand] = useState("");
  const receipt = governance.authorityReceipts.find((candidate) => candidate.id === receiptId);
  const now = new Date().toISOString();
  const effective =
    receipt !== undefined &&
    receipt.revokedAt === null &&
    (receipt.expiresAt === null || receipt.expiresAt > now);
  const dryRun = !command.trim()
    ? null
    : effective && receipt.allowedCommands.includes(command.trim())
      ? "Allowed by this immutable receipt"
      : "Denied by current receipt";

  return (
    <div className="space-y-8">
      <SettingsSectionShell title="Human directives">
        {governance.humanDirectives.length === 0 ? (
          <SettingsEmptyState layout="status">
            No durable Human directive exists.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {governance.humanDirectives.map((directive) => (
              <SettingsListRow
                key={directive.id}
                title={directive.text}
                description={`${directive.scope.length} scopes · issued ${formatTime(directive.issuedAt)}`}
                actions={statusValue(directive.status)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSectionShell title="Standing mandates">
        {governance.standingMandates.length === 0 ? (
          <SettingsEmptyState layout="status">No standing mandate exists.</SettingsEmptyState>
        ) : (
          <SettingsCard>
            {governance.standingMandates.map((mandate) => (
              <SettingsListRow
                key={mandate.id}
                title={mandate.concern}
                description={`${mandate.allowedCommands.length} commands · ${mandate.scope.length} scopes`}
                actions={statusValue(mandate.status)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSectionShell title="Root leases & interventions">
        <SettingsCard>
          {governance.rootLeases.map((lease) => (
            <SettingsListRow
              key={lease.id}
              title={`Root · Room ${lease.roomId}`}
              description={`holder ${lease.holderSeatId} · receipt ${lease.acquiredUnderReceiptId}`}
              actions={statusValue(lease.status)}
            />
          ))}
          {governance.directInterventions.map((intervention) => (
            <SettingsListRow
              key={intervention.id}
              title={intervention.workRequest}
              description={`target ${intervention.targetPeerSeatId} · Root ${intervention.rootHolderSeatId} · evidence ${intervention.evidenceRefs.length}`}
              actions={statusValue(intervention.lifecycleState)}
            />
          ))}
          {governance.rootLeases.length === 0 && governance.directInterventions.length === 0 ? (
            <SettingsEmptyState layout="status">
              No Root lease or direct intervention is recorded.
            </SettingsEmptyState>
          ) : null}
        </SettingsCard>
      </SettingsSectionShell>

      <SettingsSectionShell title="Effective authority preview">
        <SettingsCard divided={false}>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <select
              className={SELECT_CLASS_NAME}
              aria-label="Authority receipt"
              value={receiptId}
              onChange={(event) => setReceiptId(event.target.value)}
            >
              <option value="">Select authority receipt…</option>
              {governance.authorityReceipts.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.effectiveRole} · {candidate.actorSeatId}
                </option>
              ))}
            </select>
            <Input
              aria-label="Dry-run command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="Dry-run internal command ID"
            />
          </div>
          {receipt ? (
            <SettingsListRow
              title={`${receipt.identityRole} → ${receipt.effectiveRole}`}
              description={`${receipt.workspaceScopes.length} workspaces · ${receipt.roomScopes.length} Rooms · ${receipt.taskNodeScopes.length} tasks · RunPolicy r${receipt.runPolicyRevision}`}
              actions={statusValue(effective ? "effective" : "revoked or expired")}
            />
          ) : null}
          {dryRun ? (
            <SettingsListRow
              title="Dry-run result"
              description={command.trim()}
              actions={statusValue(dryRun)}
            />
          ) : null}
        </SettingsCard>
      </SettingsSectionShell>

      <SettingsSection title="Authority audit">
        <SettingsRow
          title="Immutable receipts"
          description="Authority is read from durable EffectiveAuthorityReceipts, never inferred from active UI state."
          control={statusValue(String(governance.authorityReceipts.length))}
        />
        <SettingsRow
          title="Intervention policy"
          description="Material direct intervention must notify the current Root holder and reconcile back through Lead authority."
          control={statusValue("Fail closed")}
        />
        <SettingsRow
          title="Runtime audit entries"
          description="Owner control-plane actions and outcomes recorded by the Supervised runtime."
          control={statusValue(String(runtimeAudit.length))}
        />
      </SettingsSection>

      <SettingsSectionShell title="Recent authority audit history">
        {runtimeAudit.length === 0 ? (
          <SettingsEmptyState layout="status">
            No Supervised runtime audit entry exists.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {[...runtimeAudit]
              .sort((left, right) => right.sequence - left.sequence)
              .slice(0, 50)
              .map((entry) => (
                <SettingsListRow
                  key={entry.sequence}
                  title={`${entry.action} · ${entry.outcome}`}
                  description={`${entry.targetKind} ${entry.targetId} · actor ${entry.actor.kind}`}
                  actions={statusValue(formatTime(entry.occurredAt))}
                />
              ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>
    </div>
  );
}

function LifecyclePanel({ snapshot }: { readonly snapshot: SupervisedSettingsSnapshot }) {
  const governance = snapshot.governance;
  const providerSessions = governance.providerSessions ?? [];
  const handoffs = governance.handoffs ?? [];
  const roleAssumptions = governance.roleAssumptions ?? [];
  const leadReplacements = governance.leadReplacements ?? [];
  return (
    <div className="space-y-8">
      <SettingsSectionShell title="Supervised Workspaces">
        {governance.workspaces.length === 0 ? (
          <SettingsEmptyState layout="status">
            No durable Supervised Workspace exists.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {governance.workspaces.map((workspace) => (
              <SettingsListRow
                key={workspace.id}
                title={workspace.title}
                description={`${workspace.ownerNamespace} · revision ${workspace.revision} · updated ${formatTime(workspace.updatedAt)}`}
                actions={statusValue(workspace.lifecycleState)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSectionShell title="Rooms">
        {snapshot.runtime.rooms.length === 0 ? (
          <SettingsEmptyState layout="status">No durable Room exists.</SettingsEmptyState>
        ) : (
          <SettingsCard>
            {snapshot.runtime.rooms.map((room) => (
              <SettingsListRow
                key={room.id}
                title={room.title}
                description={`Project ${room.projectId} · Lead ${room.leadSeatId ?? "not provisioned"} · graph revision ${room.graphRevision}`}
                actions={statusValue(room.status)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSectionShell>

      <SettingsSectionShell title="AgentSeats & provider sessions">
        <SettingsCard>
          {governance.agentSeats.map((seat) => (
            <SettingsListRow
              key={seat.id}
              title={`${seat.identityRole} · ${seat.effectiveRole}`}
              description={`${seat.id} · ${seat.workState} · Rooms ${seat.roomIds.length} · provider session ${seat.providerSessionId ?? "none"}`}
              actions={statusValue(seat.lifecycleState)}
            />
          ))}
          {providerSessions.map((session) => (
            <SettingsListRow
              key={session.id}
              title={`${session.provider} session`}
              description={`${session.id} · seat ${session.seatId} · native ${session.nativeSessionId ?? "not assigned"}`}
              actions={statusValue(session.lifecycleState)}
            />
          ))}
          {governance.agentSeats.length === 0 && providerSessions.length === 0 ? (
            <SettingsEmptyState layout="status">
              No governed seat or provider session exists.
            </SettingsEmptyState>
          ) : null}
        </SettingsCard>
      </SettingsSectionShell>

      <SettingsSectionShell title="Handoffs, role assumptions & Lead replacement">
        <SettingsCard>
          {handoffs.map((handoff) => (
            <SettingsListRow
              key={handoff.id}
              title={`Handoff ${handoff.fromSeatId} → ${handoff.toSeatId}`}
              description={`Room ${handoff.roomId} · evidence ${handoff.evidenceRefs.length} · revision ${handoff.revision}`}
              actions={statusValue(handoff.lifecycleState)}
            />
          ))}
          {roleAssumptions.map((assumption) => (
            <SettingsListRow
              key={assumption.id}
              title={`${assumption.operation} Root role`}
              description={`${assumption.previousRootSeatId} → ${assumption.actorSeatId} · handoff ${assumption.handoffId}`}
              actions={statusValue(assumption.lifecycleState)}
            />
          ))}
          {leadReplacements.map((replacement) => (
            <SettingsListRow
              key={replacement.id}
              title={`Replace Lead ${replacement.previousLeadSeatId}`}
              description={`replacement ${replacement.replacementLeadSeatId} · handoff ${replacement.handoffId}`}
              actions={statusValue(replacement.lifecycleState)}
            />
          ))}
          {governance.directInterventions.map((intervention) => (
            <SettingsListRow
              key={intervention.id}
              title={`Intervention ${intervention.targetPeerSeatId}`}
              description={`Room ${intervention.roomId} · Root ${intervention.rootHolderSeatId} · evidence ${intervention.evidenceRefs.length}`}
              actions={statusValue(intervention.lifecycleState)}
            />
          ))}
          {handoffs.length === 0 &&
          roleAssumptions.length === 0 &&
          leadReplacements.length === 0 &&
          governance.directInterventions.length === 0 ? (
            <SettingsEmptyState layout="status">
              No lifecycle transition is currently retained.
            </SettingsEmptyState>
          ) : null}
        </SettingsCard>
      </SettingsSectionShell>
    </div>
  );
}

function ToolsPanel({
  snapshot,
  refetch,
}: {
  readonly snapshot: SupervisedSettingsSnapshot;
  readonly refetch: () => Promise<unknown>;
}) {
  const [search, setSearch] = useState("");
  const runtimeAudit = snapshot.runtime.audit ?? [];
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const tools = snapshot.tools.filter((tool) =>
    `${tool.id} ${tool.displayName} ${tool.description} ${tool.allowedRoles.join(" ")}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );

  const updatePolicy = async (tool: SupervisedSystemTool, state: SupervisedToolPolicyState) => {
    const api = readNativeApi();
    if (!api) return;
    setBusy(tool.id);
    setFeedback(null);
    try {
      await api.orchestration.updateSupervisedToolPolicy({
        toolId: tool.id,
        state,
        reason: reason.trim() || null,
        expectedRevision: tool.policy.revision,
      });
      await refetch();
      setFeedback(
        `${tool.id} is now ${state}. Injection and server execution use the same durable policy.`,
      );
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const runPolicy = snapshot.runtime.runPolicies[0];
  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <Input
          aria-label="Search system tools"
          placeholder="Search canonical ID, role, or capability…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Input
          aria-label="Tool policy reason"
          maxLength={32_768}
          placeholder="Owner policy reason (optional)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      <SettingsSectionShell title="Canonical tool registry">
        {tools.length === 0 ? (
          <SettingsEmptyState layout="status">
            No canonical tool matches this search.
          </SettingsEmptyState>
        ) : (
          <SettingsCard>
            {tools.map((tool) => {
              const audits = runtimeAudit
                .filter((entry) => entry.targetId === tool.id)
                .sort((left, right) => right.sequence - left.sequence);
              const lastAudit = audits[0] ?? null;
              const scopeSummary = [
                summarizeScopeIds("workspaces", tool.allowedScopes.workspaceIds),
                summarizeScopeIds("Rooms", tool.allowedScopes.roomIds),
                summarizeScopeIds("tasks", tool.allowedScopes.taskNodeIds),
              ]
                .filter((value): value is string => value !== null)
                .join(" · ");
              return (
                <SettingsListRow
                  key={tool.id}
                  align="start"
                  title={tool.displayName}
                  description={
                    <span>
                      {tool.id} · schema {tool.schemaVersion} · {tool.source}
                      <br />
                      adapters: {tool.providerToolNames.join(", ") || "none"}
                      <br />
                      {tool.readOnly ? "read" : "mutate"} · roles {tool.allowedRoles.join(", ")} ·
                      commands {tool.internalCommands.join(", ") || "none"}
                      <br />
                      scopes: {scopeSummary || "no active grants"} · authority receipt required
                      <br />
                      health {tool.health} · RunPolicy r{runPolicy?.revision ?? 0} · recent receipts{" "}
                      {tool.successCount} succeeded / {tool.failureCount} failed · audit{" "}
                      {audits.length}
                      <br />
                      last invocation:{" "}
                      {tool.lastInvocation
                        ? `${tool.lastInvocation.state} at ${formatTime(tool.lastInvocation.requestedAt)}`
                        : "never"}
                      <br />
                      last audit:{" "}
                      {lastAudit
                        ? `${lastAudit.action} · ${lastAudit.outcome} at ${formatTime(lastAudit.occurredAt)}`
                        : "none"}
                      {tool.policy.reason ? ` · reason: ${tool.policy.reason}` : ""}
                    </span>
                  }
                  actions={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {statusValue(`${tool.policy.state} · r${tool.policy.revision}`)}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === tool.id || tool.policy.state === "revoked"}
                        onClick={() =>
                          void updatePolicy(
                            tool,
                            tool.policy.state === "enabled" ? "disabled" : "enabled",
                          )
                        }
                      >
                        {tool.policy.state === "enabled" ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === tool.id || tool.policy.state === "revoked"}
                        onClick={() => void updatePolicy(tool, "revoked")}
                      >
                        Revoke
                      </Button>
                    </div>
                  }
                />
              );
            })}
          </SettingsCard>
        )}
      </SettingsSectionShell>
      <SettingsSection title="Policy bounds">
        <SettingsRow
          title="Injection"
          description="Disabled or revoked canonical intents are removed before provider tool injection."
          control={statusValue("Server enforced")}
        />
        <SettingsRow
          title="Execution"
          description="Every direct server execution rechecks durable policy before authority and handler dispatch."
          control={statusValue("Fail closed")}
        />
        <SettingsRow
          title="RunPolicy"
          description="Tool calls remain bounded by immutable authority receipts, allowed commands, Room scope, and the active RunPolicy snapshot."
          control={statusValue(runPolicy ? `revision ${runPolicy.revision}` : "default bounds")}
        />
      </SettingsSection>
      <div className="min-h-5 text-[11px] text-muted-foreground" aria-live="polite">
        {feedback}
      </div>
    </div>
  );
}

export function SupervisedGovernanceSettingsPanel(props: {
  readonly active: boolean;
  readonly surface: SupervisedGovernanceSettingsSurface;
}) {
  const query = useQuery({ ...supervisedSettingsQueryOptions(), enabled: props.active });
  if (!props.active) return null;
  if (query.isLoading) {
    return (
      <SettingsEmptyState layout="status">Loading durable Supervised settings…</SettingsEmptyState>
    );
  }
  if (!query.data || query.error) {
    return (
      <SettingsEmptyState layout="status" tone="destructive">
        {query.error instanceof Error ? query.error.message : "Supervised settings unavailable."}
      </SettingsEmptyState>
    );
  }
  const refetch = () => query.refetch().then(() => undefined);
  switch (props.surface) {
    case "general":
      return <GeneralPanel snapshot={query.data} />;
    case "models":
      return <ModelsPanel snapshot={query.data} refetch={refetch} />;
    case "notebook":
      return <NotebookPanel snapshot={query.data} />;
    case "authority":
      return <AuthorityPanel snapshot={query.data} />;
    case "lifecycle":
      return <LifecyclePanel snapshot={query.data} />;
    case "tools":
      return <ToolsPanel snapshot={query.data} refetch={refetch} />;
  }
}
