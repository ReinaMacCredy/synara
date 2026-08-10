import {
  DEFAULT_SUPERVISED_RUN_POLICY,
  type AuthorityScope,
  type HarnessPatch,
  type ProjectId,
  type RoomId,
  type RunPolicy,
  type SupervisedPluginInspection,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { DisclosureRegion } from "~/components/ui/DisclosureRegion";
import { Input } from "~/components/ui/input";
import { supervisedRuntimeQueryOptions } from "~/lib/supervisedRuntime";
import {
  formatSupervisedRuntimeDiagnostics,
  supervisedRuntimeTraceEntries,
  type SupervisedRuntimeTraceKind,
} from "~/lib/supervisedRuntimeDiagnostics";
import { newCommandId } from "~/lib/utils";
import { readNativeApi } from "~/nativeApi";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsRow,
  SettingsSection,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

type PluginCapability = SupervisedPluginInspection["manifest"]["requestedCapabilities"][number];

const value = (text: string) => (
  <span className="text-xs tabular-nums text-foreground/80">{text}</span>
);

const HARNESS_PATCH_STATUS_LABEL: Readonly<Record<HarnessPatch["status"], string>> = {
  observed: "Observed",
  proposed: "Proposed",
  sandboxed: "Sandboxed",
  evaluated: "Evaluated",
  awaiting_approval: "Awaiting approval",
  canary: "Canary",
  promoted: "Promoted",
  rejected: "Rejected",
  failed: "Failed",
  rolled_back: "Rolled back",
  revoked: "Revoked",
};

export function harnessPatchScopeLabel(scope: HarnessPatch["scope"]): string {
  switch (scope.kind) {
    case "profile":
      return `Profile ${scope.profilePresetId}`;
    case "project":
      return `Project ${scope.projectId}`;
    case "room":
      return `Room ${scope.roomId}`;
    case "task":
      return `Task ${scope.taskId}`;
  }
}

export function harnessPatchLifecycleSummary(patch: HarnessPatch): {
  readonly label: string;
  readonly detail: string;
} {
  const observationCount = (patch.observationEvidenceRefs ?? []).length;
  const evaluationCount = patch.evaluationEvidenceRefs.length;
  switch (patch.status) {
    case "observed":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: `${observationCount} durable observation evidence`,
      };
    case "proposed":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: `Awaiting sandbox evaluation · ${observationCount} observation evidence`,
      };
    case "sandboxed":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: "Sandbox evaluation pending",
      };
    case "evaluated":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: `Sandbox passed · ${evaluationCount} evaluation evidence`,
      };
    case "awaiting_approval":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: "Explicit Human approval is required before canary activation",
      };
    case "canary":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: `${patch.canary?.successfulEvaluations ?? 0} passed · ${patch.canary?.observedFailures ?? 0}/${patch.canary?.failureThreshold ?? 0} failed`,
      };
    case "promoted":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: `Promoted after ${patch.canary?.successfulEvaluations ?? 0} successful canary evaluations`,
      };
    case "failed":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail:
          patch.sandboxEvaluation?.regressions.join(" · ") || "Sandbox evaluation did not pass",
      };
    case "rolled_back":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: patch.rollback?.reason ?? "Rollback receipt unavailable",
      };
    case "rejected":
    case "revoked":
      return {
        label: HARNESS_PATCH_STATUS_LABEL[patch.status],
        detail: `${observationCount + evaluationCount} retained evidence references`,
      };
  }
}

export type SupervisedRuntimeSettingsSurface = "runtime" | "plugins" | "diagnostics";

export function SupervisedRuntimeSettingsPanel(props: {
  readonly active: boolean;
  readonly surface: SupervisedRuntimeSettingsSurface;
}) {
  const query = useQuery({ ...supervisedRuntimeQueryOptions(), enabled: props.active });
  const [pluginEditorOpen, setPluginEditorOpen] = useState(false);
  const [pluginDirectory, setPluginDirectory] = useState("");
  const [pluginInspection, setPluginInspection] = useState<SupervisedPluginInspection | null>(null);
  const [selectedCapabilities, setSelectedCapabilities] = useState<ReadonlySet<PluginCapability>>(
    new Set(),
  );
  const [selectedPayloadFields, setSelectedPayloadFields] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [selectedActions, setSelectedActions] = useState<ReadonlySet<string>>(new Set());
  const [pluginScopeKind, setPluginScopeKind] = useState<"global" | "project" | "room">("global");
  const [pluginScopeId, setPluginScopeId] = useState("");
  const [enableAfterInstall, setEnableAfterInstall] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [runtimeTraceOpen, setRuntimeTraceOpen] = useState(false);
  const [runtimeTraceKind, setRuntimeTraceKind] = useState<"all" | SupervisedRuntimeTraceKind>(
    "all",
  );
  const [runtimeTraceSearch, setRuntimeTraceSearch] = useState("");
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [expandedSchemaId, setExpandedSchemaId] = useState<string | null>(null);
  const [runtimeLogsDirectory, setRuntimeLogsDirectory] = useState<string | null>(null);
  const [maxRecursiveCalls, setMaxRecursiveCalls] = useState(
    String(DEFAULT_SUPERVISED_RUN_POLICY.maxRecursiveCalls),
  );
  const [maxFanOut, setMaxFanOut] = useState(String(DEFAULT_SUPERVISED_RUN_POLICY.maxFanOut));
  const [maxPluginHandlerMs, setMaxPluginHandlerMs] = useState(
    String(DEFAULT_SUPERVISED_RUN_POLICY.maxPluginHandlerMs),
  );
  const [maxSubscriptions, setMaxSubscriptions] = useState(
    String(DEFAULT_SUPERVISED_RUN_POLICY.maxSubscriptions),
  );
  const [maxPlugins, setMaxPlugins] = useState(String(DEFAULT_SUPERVISED_RUN_POLICY.maxPlugins));
  const [replayBehavior, setReplayBehavior] = useState<RunPolicy["replayBehavior"]>(
    DEFAULT_SUPERVISED_RUN_POLICY.replayBehavior,
  );

  const currentPolicy = query.data?.runPolicies[0] ?? null;
  const traceEntries = useMemo(() => {
    if (!query.data) return [];
    const search = runtimeTraceSearch.trim().toLocaleLowerCase();
    return supervisedRuntimeTraceEntries(query.data).filter((entry) => {
      if (runtimeTraceKind !== "all" && entry.kind !== runtimeTraceKind) return false;
      if (!search) return true;
      return `${entry.title} ${entry.description} ${JSON.stringify(entry.details)}`
        .toLocaleLowerCase()
        .includes(search);
    });
  }, [query.data, runtimeTraceKind, runtimeTraceSearch]);
  useEffect(() => {
    if (!currentPolicy) return;
    setMaxRecursiveCalls(String(currentPolicy.maxRecursiveCalls));
    setMaxFanOut(String(currentPolicy.maxFanOut));
    setMaxPluginHandlerMs(String(currentPolicy.maxPluginHandlerMs));
    setMaxSubscriptions(String(currentPolicy.maxSubscriptions));
    setMaxPlugins(String(currentPolicy.maxPlugins));
    setReplayBehavior(currentPolicy.replayBehavior);
  }, [currentPolicy?.id, currentPolicy?.revision]);

  const saveRunPolicy = async (restoreDefaults = false) => {
    const api = readNativeApi();
    const now = new Date().toISOString();
    if (!api) return;
    const numbers = restoreDefaults
      ? {
          maxRecursiveCalls: DEFAULT_SUPERVISED_RUN_POLICY.maxRecursiveCalls,
          maxFanOut: DEFAULT_SUPERVISED_RUN_POLICY.maxFanOut,
          maxPluginHandlerMs: DEFAULT_SUPERVISED_RUN_POLICY.maxPluginHandlerMs,
          maxSubscriptions: DEFAULT_SUPERVISED_RUN_POLICY.maxSubscriptions,
          maxPlugins: DEFAULT_SUPERVISED_RUN_POLICY.maxPlugins,
        }
      : {
          maxRecursiveCalls: Number(maxRecursiveCalls),
          maxFanOut: Number(maxFanOut),
          maxPluginHandlerMs: Number(maxPluginHandlerMs),
          maxSubscriptions: Number(maxSubscriptions),
          maxPlugins: Number(maxPlugins),
        };
    if (
      !Number.isInteger(numbers.maxRecursiveCalls) ||
      numbers.maxRecursiveCalls < 0 ||
      !Number.isInteger(numbers.maxFanOut) ||
      numbers.maxFanOut < 1 ||
      !Number.isInteger(numbers.maxPluginHandlerMs) ||
      numbers.maxPluginHandlerMs < 1 ||
      !Number.isInteger(numbers.maxSubscriptions) ||
      numbers.maxSubscriptions < 1 ||
      !Number.isInteger(numbers.maxPlugins) ||
      numbers.maxPlugins < 1
    ) {
      setFeedback("RunPolicy values must be bounded whole numbers.");
      return;
    }
    const runPolicy: RunPolicy = currentPolicy
      ? {
          ...currentPolicy,
          ...numbers,
          replayBehavior: restoreDefaults
            ? DEFAULT_SUPERVISED_RUN_POLICY.replayBehavior
            : replayBehavior,
          updatedAt: now,
        }
      : {
          id: "supervised-default-v1" as RunPolicy["id"],
          name: "Supervised default",
          ...DEFAULT_SUPERVISED_RUN_POLICY,
          ...numbers,
          maxCostUsd: null,
          allowedCapabilities: ["filesystem.read"],
          allowedPluginActions: [
            "supervised.compaction.request",
            "supervised.handoff.request",
            "supervised.intervention.propose",
          ],
          revision: 0,
          createdAt: now,
          updatedAt: now,
        };
    setBusy("run-policy");
    setFeedback(null);
    try {
      await api.orchestration.dispatchCommand({
        type: "supervised.run-policy.upsert",
        commandId: newCommandId(),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: runPolicy.id,
        expectedRevision: currentPolicy?.revision ?? 0,
        idempotencyKey: crypto.randomUUID(),
        createdAt: now,
        runPolicy,
      });
      await query.refetch();
      setFeedback(
        restoreDefaults ? "RunPolicy defaults restored." : "RunPolicy saved for future Runs.",
      );
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const inspectPlugin = async (directory = pluginDirectory) => {
    const api = readNativeApi();
    if (!api || directory.trim().length === 0) return;
    setBusy("inspect");
    setFeedback(null);
    try {
      const inspection = await api.orchestration.inspectSupervisedPlugin({
        directory: directory.trim(),
      });
      setPluginDirectory(inspection.directory);
      setPluginInspection(inspection);
      setSelectedCapabilities(
        new Set(
          inspection.manifest.requestedCapabilities.filter(
            (capability) =>
              capability !== "network.connect" &&
              capability !== "filesystem.write" &&
              capability !== "tool.invoke",
          ),
        ),
      );
      setSelectedPayloadFields(
        new Set(
          inspection.manifest.requestedPayloadFields.filter(
            (field) => !inspection.protectedPayloadFields.includes(field),
          ),
        ),
      );
      setSelectedActions(new Set());
    } catch (cause) {
      setPluginInspection(null);
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const browsePlugin = async () => {
    const api = readNativeApi();
    if (!api) return;
    const directory = await api.dialogs.pickFolder();
    if (directory) await inspectPlugin(directory);
  };

  const installPlugin = async () => {
    const api = readNativeApi();
    if (!api || !pluginInspection) return;
    if (pluginScopeKind !== "global" && pluginScopeId.trim().length === 0) {
      setFeedback("Enter the Project or Room identifier for this grant.");
      return;
    }
    const scope: AuthorityScope =
      pluginScopeKind === "global"
        ? { kind: "global" }
        : pluginScopeKind === "project"
          ? { kind: "project", projectId: pluginScopeId.trim() as ProjectId }
          : { kind: "room", roomId: pluginScopeId.trim() as RoomId };
    setBusy("install");
    setFeedback(null);
    try {
      const result = await api.orchestration.installSupervisedPlugin({
        directory: pluginInspection.directory,
        enableAfterInstall,
        capabilities: [...selectedCapabilities],
        payloadFields: [...selectedPayloadFields],
        scopes: [scope],
        allowedActionRequests: [...selectedActions],
      });
      setFeedback(
        `${result.installation.manifest.name} ${result.operation}${enableAfterInstall ? " and enabled" : " without starting"}.`,
      );
      setPluginEditorOpen(false);
      setPluginInspection(null);
      await query.refetch();
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const changePluginState = async (
    plugin: NonNullable<typeof query.data>["plugins"][number],
    type: "supervised.plugin.enable" | "supervised.plugin.disable" | "supervised.plugin.revoke",
  ) => {
    const api = readNativeApi();
    if (!api) return;
    setBusy(plugin.pluginId);
    setFeedback(null);
    try {
      await api.orchestration.dispatchCommand({
        type,
        commandId: newCommandId(),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: plugin.pluginId,
        expectedRevision: plugin.revision,
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pluginId: plugin.pluginId,
      });
      await query.refetch();
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const redriveDeadLetter = async (deadLetterId: string) => {
    const api = readNativeApi();
    const letter = query.data?.deadLetters.find((candidate) => candidate.id === deadLetterId);
    const delivery = letter
      ? query.data?.deliveries.find((candidate) => candidate.id === letter.deliveryId)
      : null;
    if (!api || !letter || !delivery) return;
    setBusy(letter.id);
    setFeedback(null);
    try {
      await api.orchestration.dispatchCommand({
        type: "supervised.delivery.redrive",
        commandId: newCommandId(),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: delivery.id,
        expectedRevision: delivery.attemptCount,
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        deadLetterId: letter.id,
        replayBehavior: "observe_only",
      });
      await query.refetch();
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const reconcileRuntime = async () => {
    const api = readNativeApi();
    if (!api) return;
    setBusy("reconcile");
    setFeedback(null);
    try {
      const health = await api.orchestration.reconcileSupervisedRuntime();
      await query.refetch();
      setFeedback(`Daemon reconciled at epoch ${health.daemonEpoch}; status ${health.status}.`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const loadRuntimeDiagnostics = async () => {
    const api = readNativeApi();
    if (!api) throw new Error("Native API not found");
    const diagnostics = await api.server.getDiagnostics();
    setRuntimeLogsDirectory(diagnostics.logsDirectory);
    return { api, diagnostics };
  };

  const openRuntimeLogs = async () => {
    setBusy("open-runtime-logs");
    setFeedback(null);
    setRuntimeTraceOpen(true);
    try {
      const { api, diagnostics } = await loadRuntimeDiagnostics();
      if (typeof window !== "undefined" && window.desktopBridge) {
        await api.shell.showInFolder(diagnostics.serverLogPath);
        setFeedback("Runtime trace opened and the local log file was revealed.");
      } else {
        setFeedback("Runtime trace opened. Local log reveal is available in the desktop app.");
      }
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const copyRuntimeDiagnostics = async () => {
    if (!query.data) return;
    setBusy("copy-diagnostics");
    setFeedback(null);
    try {
      const { diagnostics } = await loadRuntimeDiagnostics();
      await navigator.clipboard.writeText(
        formatSupervisedRuntimeDiagnostics({ runtime: query.data, server: diagnostics }),
      );
      setFeedback("Bounded runtime diagnostics copied without protected event payloads.");
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const restartRuntime = async () => {
    const api = readNativeApi();
    if (!api) return;
    setBusy("restart-runtime");
    setFeedback(null);
    try {
      const health = await api.orchestration.reconcileSupervisedRuntime({ restart: true });
      await query.refetch();
      setFeedback(`Daemon restarted at epoch ${health.daemonEpoch}; status ${health.status}.`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const resetPluginCircuit = async (plugin: NonNullable<typeof query.data>["plugins"][number]) => {
    const api = readNativeApi();
    if (!api) return;
    setBusy(plugin.pluginId);
    setFeedback(null);
    try {
      await api.orchestration.dispatchCommand({
        type: "supervised.plugin.reset-circuit",
        commandId: newCommandId(),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: plugin.pluginId,
        expectedRevision: plugin.revision,
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pluginId: plugin.pluginId,
      });
      await query.refetch();
      setFeedback(`${plugin.manifest.name} circuit reset.`);
    } catch (cause) {
      setFeedback(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  if (!props.active) return null;
  if (query.isLoading) {
    return <SettingsEmptyState layout="status">Loading Supervised runtime…</SettingsEmptyState>;
  }
  if (!query.data || query.error) {
    return (
      <SettingsEmptyState layout="status" tone="destructive">
        {query.error instanceof Error ? query.error.message : "Supervised runtime unavailable."}
      </SettingsEmptyState>
    );
  }
  const snapshot = query.data;
  const health = snapshot.health;
  const harnessPatches = [...(snapshot.harnessPatches ?? [])].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      (right.revision ?? 0) - (left.revision ?? 0),
  );
  const activeHarnessPatchCount = harnessPatches.filter(
    (patch) => patch.status === "canary" || patch.status === "promoted",
  ).length;
  const approvalPendingHarnessPatchCount = harnessPatches.filter(
    (patch) => patch.status === "awaiting_approval",
  ).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/55 pb-5">
        {props.surface === "diagnostics" ? (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "open-runtime-logs"}
              onClick={() => void openRuntimeLogs()}
            >
              {busy === "open-runtime-logs" ? "Opening…" : "Open runtime logs"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy === "copy-diagnostics"}
              onClick={() => void copyRuntimeDiagnostics()}
            >
              {busy === "copy-diagnostics" ? "Copying…" : "Copy diagnostics"}
            </Button>
          </>
        ) : null}
        {props.surface === "runtime" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy === "restart-runtime"}
            onClick={() => void restartRuntime()}
          >
            {busy === "restart-runtime" ? "Restarting…" : "Restart daemon"}
          </Button>
        ) : null}
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          snapshot #{snapshot.snapshotSequence} · updated{" "}
          {new Date(snapshot.updatedAt).toLocaleTimeString()}
        </span>
      </div>

      {props.surface === "runtime" ? (
        <SettingsSectionShell
          title="Runtime lifecycle"
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                Refresh
              </Button>
              <Button
                size="sm"
                disabled={busy === "reconcile"}
                onClick={() => void reconcileRuntime()}
              >
                {busy === "reconcile" ? "Reconciling…" : "Reconcile daemon"}
              </Button>
            </div>
          }
        >
          <SettingsCard>
            <SettingsRow
              title="Supervised runtime"
              description="Runs the background control plane for Lead Rooms, durable events, recovery, and notifications."
              status={`Last recovery ${health.lastRecoveryAt ? new Date(health.lastRecoveryAt).toLocaleString() : "not yet"}`}
              control={
                <div className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full ${health.status === "healthy" ? "bg-emerald-500" : health.status === "degraded" ? "bg-amber-500" : "bg-muted-foreground"}`}
                  />
                  {value(`${health.status} · epoch ${health.daemonEpoch}`)}
                </div>
              }
            />
            <SettingsRow
              title="Signal delivery"
              description="At-least-once queue with durable cursors, cooldown, re-arm, and DeadLetters."
              control={value(
                `${health.deliveryQueueDepth} queued · ${health.deadLetterCount} dead`,
              )}
            />
            <SettingsRow
              title="Programmable kernels"
              description="Persistent JavaScript and Python child processes; untrusted execution fails closed without isolation."
              control={value("JavaScript · Python")}
            />
          </SettingsCard>
        </SettingsSectionShell>
      ) : null}

      <DisclosureRegion open={props.surface === "diagnostics" && runtimeTraceOpen}>
        <SettingsSectionShell
          title="Runtime trace"
          action={
            <Button size="sm" variant="ghost" onClick={() => setRuntimeTraceOpen(false)}>
              Close trace
            </Button>
          }
        >
          <SettingsCard divided={false}>
            <div className="border-b border-border/55 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-wrap gap-1">
                  {(["all", "audit", "signal", "delivery"] as const).map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant={runtimeTraceKind === kind ? "default" : "ghost"}
                      onClick={() => setRuntimeTraceKind(kind)}
                    >
                      {kind === "all"
                        ? "All"
                        : kind === "delivery"
                          ? "Deliveries"
                          : `${kind[0]!.toUpperCase()}${kind.slice(1)}s`}
                    </Button>
                  ))}
                </div>
                <Input
                  aria-label="Search runtime trace"
                  className="sm:ml-auto sm:max-w-72"
                  placeholder="Filter by ID, status, or event…"
                  value={runtimeTraceSearch}
                  onChange={(event) => setRuntimeTraceSearch(event.target.value)}
                />
              </div>
              {runtimeLogsDirectory ? (
                <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">
                  Local logs: {runtimeLogsDirectory}
                </p>
              ) : null}
            </div>
            {traceEntries.length === 0 ? (
              <SettingsEmptyState layout="status">
                {runtimeTraceSearch
                  ? "No runtime trace matches this filter."
                  : "No runtime trace recorded yet."}
              </SettingsEmptyState>
            ) : (
              <div className="divide-y divide-border/55">
                {traceEntries.slice(0, 50).map((entry) => {
                  const open = expandedTraceId === entry.id;
                  return (
                    <div key={entry.id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/35 active:bg-muted/55"
                        aria-expanded={open}
                        onClick={() => setExpandedTraceId(open ? null : entry.id)}
                      >
                        <span className="mt-0.5 min-w-14 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                          {entry.kind}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">
                            {entry.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {entry.description}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                          {new Date(entry.occurredAt).toLocaleTimeString()}
                        </span>
                      </button>
                      <DisclosureRegion open={open}>
                        <pre className="overflow-x-auto border-t border-border/45 bg-muted/20 px-4 py-3 font-mono text-[10px] leading-4 text-foreground/75">
                          {JSON.stringify(entry.details, null, 2)}
                        </pre>
                      </DisclosureRegion>
                    </div>
                  );
                })}
              </div>
            )}
          </SettingsCard>
        </SettingsSectionShell>
      </DisclosureRegion>

      {props.surface === "runtime" ? (
        <>
          <SettingsSectionShell
            title="RunPolicy & autonomous bounds"
            action={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === "run-policy"}
                  onClick={() => void saveRunPolicy(true)}
                >
                  Restore defaults
                </Button>
                <Button
                  size="sm"
                  disabled={busy === "run-policy"}
                  onClick={() => void saveRunPolicy()}
                >
                  Save bounds
                </Button>
              </div>
            }
          >
            <SettingsCard>
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  Recursive calls
                  <Input
                    inputMode="numeric"
                    value={maxRecursiveCalls}
                    onChange={(event) => setMaxRecursiveCalls(event.target.value)}
                  />
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  Fan-out
                  <Input
                    inputMode="numeric"
                    value={maxFanOut}
                    onChange={(event) => setMaxFanOut(event.target.value)}
                  />
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  Plugin handler timeout (ms)
                  <Input
                    inputMode="numeric"
                    value={maxPluginHandlerMs}
                    onChange={(event) => setMaxPluginHandlerMs(event.target.value)}
                  />
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  Replay behavior
                  <select
                    aria-label="Replay behavior"
                    className="h-9 w-full rounded-lg border border-border bg-transparent px-3 text-xs text-foreground"
                    value={replayBehavior}
                    onChange={(event) =>
                      setReplayBehavior(event.target.value as RunPolicy["replayBehavior"])
                    }
                  >
                    <option value="disabled">Disabled</option>
                    <option value="observe_only">Observe only</option>
                    <option value="idempotent_actions">Idempotent actions</option>
                  </select>
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  Maximum subscriptions
                  <Input
                    inputMode="numeric"
                    value={maxSubscriptions}
                    onChange={(event) => setMaxSubscriptions(event.target.value)}
                  />
                </label>
                <label className="space-y-1.5 text-[11px] text-muted-foreground">
                  Maximum plugins
                  <Input
                    inputMode="numeric"
                    value={maxPlugins}
                    onChange={(event) => setMaxPlugins(event.target.value)}
                  />
                </label>
              </div>
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSection title="Durable Context & RLM">
            <SettingsRow
              title="RLM admission"
              description="Use recursive decomposition at 65% context, 24k tokens, or four independent branches."
              control={value("Automatic")}
            />
            <SettingsRow
              title="Recursive bounds"
              description="Captured in each RunPolicy snapshot; changes apply to future Runs."
              control={value("Depth 8 · fan-out 4")}
            />
            <SettingsRow
              title="Durable workspace"
              description="Revisioned decisions, evidence, obligations, summaries, and SHA-256 blob references."
              control={value("Enabled")}
            />
          </SettingsSection>

          <SettingsSectionShell title="Harness Patch lifecycle">
            <SettingsCard>
              <SettingsRow
                title="Governed patch activation"
                description="Read-only projected lifecycle. Supervisor proposals require durable friction evidence; the daemon evaluates them in sandbox; only a Human may activate or promote a canary."
                status={`${approvalPendingHarnessPatchCount} awaiting Human approval · ${activeHarnessPatchCount} active`}
                control={value(`${harnessPatches.length} retained`)}
              />
              {harnessPatches.length === 0 ? (
                <SettingsListRow
                  title="No Harness Patch proposals retained"
                  description="The runtime snapshot has no observed, evaluated, active, or rolled-back patches."
                />
              ) : (
                harnessPatches.map((patch) => {
                  const lifecycle = harnessPatchLifecycleSummary(patch);
                  const digest = `${patch.basePolicyHash.slice(0, 18)}…`;
                  return (
                    <SettingsListRow
                      key={patch.id}
                      align="start"
                      title={
                        <span>
                          {patch.name} · v{patch.version}
                        </span>
                      }
                      description={
                        <div className="space-y-1">
                          <p>{patch.content}</p>
                          <p>{lifecycle.detail}</p>
                          <p className="break-all font-mono text-[10px] text-muted-foreground/75">
                            {harnessPatchScopeLabel(patch.scope)} · {patch.patchType} · revision{" "}
                            {patch.revision}
                            {" · "}
                            base {digest}
                          </p>
                        </div>
                      }
                      actions={value(lifecycle.label)}
                    />
                  );
                })
              )}
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSection title="Retained Peer specialties">
            <SettingsRow
              title="Retained Peer specialties"
              description="Restore only sanitized, unexpired, scope-compatible snapshots."
              control={value("Compatible only")}
            />
          </SettingsSection>
        </>
      ) : null}

      {props.surface === "plugins" ? (
        <SettingsSectionShell
          title="Plugin registry"
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPluginEditorOpen((current) => !current);
                setFeedback(null);
              }}
            >
              {pluginEditorOpen ? "Cancel" : "Install local plugin"}
            </Button>
          }
        >
          {pluginEditorOpen ? (
            <SettingsCard>
              <div className="space-y-4 p-4">
                <div>
                  <div className="text-xs font-medium text-foreground">Local plugin package</div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    Select a folder containing synara-plugin.json. Synara computes its own package
                    hash and checks handler containment before showing any grant.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    aria-label="Plugin directory"
                    placeholder="/path/to/plugin"
                    value={pluginDirectory}
                    onChange={(event) => setPluginDirectory(event.target.value)}
                  />
                  <Button size="sm" variant="outline" onClick={() => void browsePlugin()}>
                    Browse
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy === "inspect"}
                    onClick={() => void inspectPlugin()}
                  >
                    {busy === "inspect" ? "Inspecting…" : "Inspect"}
                  </Button>
                </div>
                {pluginInspection ? (
                  <div className="space-y-4 rounded-lg border border-border/65 p-3">
                    <div>
                      <div className="text-xs font-medium text-foreground">
                        {pluginInspection.manifest.name} · {pluginInspection.manifest.version}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {pluginInspection.manifest.description}
                      </p>
                      <p className="mt-1 break-all text-[10px] text-muted-foreground/75">
                        {pluginInspection.manifest.provenance.contentHash}
                      </p>
                    </div>
                    {pluginInspection.warnings.length > 0 ? (
                      <div className="rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                        {pluginInspection.warnings.join(" ")}
                      </div>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-foreground">Capabilities</div>
                        {pluginInspection.manifest.requestedCapabilities.map((capability) => (
                          <label
                            key={capability}
                            className="flex items-center gap-2 text-[11px] text-muted-foreground"
                          >
                            <Checkbox
                              checked={selectedCapabilities.has(capability)}
                              onCheckedChange={(checked) =>
                                setSelectedCapabilities((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(capability);
                                  else next.delete(capability);
                                  return next;
                                })
                              }
                            />
                            {capability}
                          </label>
                        ))}
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-foreground">
                          Payload fields
                        </div>
                        {pluginInspection.manifest.requestedPayloadFields.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            No event payload fields requested.
                          </p>
                        ) : (
                          pluginInspection.manifest.requestedPayloadFields.map((field) => (
                            <label
                              key={field}
                              className="flex items-center gap-2 text-[11px] text-muted-foreground"
                            >
                              <Checkbox
                                checked={selectedPayloadFields.has(field)}
                                onCheckedChange={(checked) =>
                                  setSelectedPayloadFields((current) => {
                                    const next = new Set(current);
                                    if (checked) next.add(field);
                                    else next.delete(field);
                                    return next;
                                  })
                                }
                              />
                              {field}
                              {pluginInspection.protectedPayloadFields.includes(field)
                                ? " · protected"
                                : ""}
                            </label>
                          ))
                        )}
                      </div>
                    </div>
                    {pluginInspection.requestedActionRequests.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-[11px] font-medium text-foreground">
                          Typed action requests
                        </div>
                        {pluginInspection.requestedActionRequests.map((action) => (
                          <label
                            key={action}
                            className="flex items-center gap-2 text-[11px] text-muted-foreground"
                          >
                            <Checkbox
                              checked={selectedActions.has(action)}
                              onCheckedChange={(checked) =>
                                setSelectedActions((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(action);
                                  else next.delete(action);
                                  return next;
                                })
                              }
                            />
                            {action}
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-[11px] text-muted-foreground">
                        Grant scope
                        <select
                          aria-label="Plugin grant scope"
                          className="h-9 w-full rounded-lg border border-border bg-transparent px-3 text-xs text-foreground"
                          value={pluginScopeKind}
                          onChange={(event) =>
                            setPluginScopeKind(event.target.value as typeof pluginScopeKind)
                          }
                        >
                          <option value="global">Global</option>
                          <option value="project">Project</option>
                          <option value="room">Lead Room</option>
                        </select>
                      </label>
                      {pluginScopeKind === "global" ? (
                        <div className="rounded-lg border border-border/65 px-3 py-2 text-[11px] text-muted-foreground">
                          Global observation does not grant authority to mutate every Room.
                        </div>
                      ) : (
                        <label className="space-y-1.5 text-[11px] text-muted-foreground">
                          {pluginScopeKind === "project" ? "Project ID" : "Room ID"}
                          <Input
                            value={pluginScopeId}
                            onChange={(event) => setPluginScopeId(event.target.value)}
                          />
                        </label>
                      )}
                    </div>
                    <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                      <Checkbox
                        checked={enableAfterInstall}
                        onCheckedChange={setEnableAfterInstall}
                      />
                      <span>
                        <span className="font-medium text-foreground">Enable after install</span>
                        <br />
                        Leave off to inspect the durable registry entry before any handler receives
                        events.
                      </span>
                    </label>
                    <div className="flex items-center justify-between gap-3 border-t border-border/55 pt-3">
                      <p className="text-[10px] text-muted-foreground">
                        Every proposed command still passes authority, expected revision,
                        idempotency, RunPolicy, and audit.
                      </p>
                      <Button
                        size="sm"
                        disabled={busy === "install"}
                        onClick={() => void installPlugin()}
                      >
                        {busy === "install" ? "Installing…" : "Install plugin"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </SettingsCard>
          ) : null}
          <SettingsCard>
            {snapshot.plugins.length === 0 ? (
              <SettingsEmptyState layout="status">
                No governed plugins installed.
              </SettingsEmptyState>
            ) : (
              snapshot.plugins.map((plugin) => {
                const pluginHealth = (snapshot.pluginHealth ?? []).find(
                  (candidate) => candidate.pluginId === plugin.pluginId,
                );
                return (
                  <SettingsListRow
                    key={plugin.pluginId}
                    title={plugin.manifest.name}
                    description={`${plugin.manifest.version} · ${plugin.grant.capabilities.join(", ") || "no capabilities"} · circuit ${pluginHealth?.circuitState ?? "closed"} · queue ${pluginHealth?.queueDepth ?? 0}`}
                    actions={
                      <div className="flex items-center gap-2">
                        {value(plugin.status)}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === plugin.pluginId || plugin.status === "revoked"}
                          onClick={() =>
                            void changePluginState(
                              plugin,
                              plugin.status === "enabled"
                                ? "supervised.plugin.disable"
                                : "supervised.plugin.enable",
                            )
                          }
                        >
                          {plugin.status === "enabled" ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === plugin.pluginId || plugin.status === "revoked"}
                          onClick={() => void changePluginState(plugin, "supervised.plugin.revoke")}
                        >
                          Revoke
                        </Button>
                        {pluginHealth?.circuitState === "open" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy === plugin.pluginId}
                            onClick={() => void resetPluginCircuit(plugin)}
                          >
                            Reset circuit
                          </Button>
                        ) : null}
                      </div>
                    }
                  />
                );
              })
            )}
          </SettingsCard>
        </SettingsSectionShell>
      ) : null}

      {props.surface === "diagnostics" ? (
        <>
          <SettingsSectionShell title="Runtime audit">
            <SettingsCard>
              {(snapshot.audit ?? []).length === 0 ? (
                <SettingsEmptyState layout="status">
                  No runtime governance actions recorded yet.
                </SettingsEmptyState>
              ) : (
                (snapshot.audit ?? [])
                  .slice(0, 20)
                  .map((entry) => (
                    <SettingsListRow
                      key={entry.sequence}
                      title={`${entry.action} · ${entry.outcome}`}
                      description={`${entry.targetKind} ${entry.targetId} · ${new Date(entry.occurredAt).toLocaleString()}`}
                      actions={value(`#${entry.sequence}`)}
                    />
                  ))
              )}
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSectionShell title="Event schema catalog">
            <SettingsCard divided={false}>
              <div className="divide-y divide-border/55">
                {snapshot.schemas.map((schema) => {
                  const open = expandedSchemaId === schema.id;
                  const classifiedFields = Object.entries(schema.fieldClassifications);
                  return (
                    <div key={schema.id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/35 active:bg-muted/55"
                        aria-expanded={open}
                        onClick={() => setExpandedSchemaId(open ? null : schema.id)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-foreground">
                            {schema.eventType}
                          </span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {schema.version} · {schema.compatibility} compatibility ·{" "}
                            {classifiedFields.length} classified fields
                          </span>
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-wide text-foreground/65">
                          {open ? "Close" : "Inspect"} · {schema.status}
                        </span>
                      </button>
                      <DisclosureRegion open={open}>
                        <div className="grid gap-4 border-t border-border/45 bg-muted/15 px-4 py-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Field classifications
                            </div>
                            <div className="mt-2 space-y-1 font-mono text-[10px]">
                              {classifiedFields.length === 0 ? (
                                <span className="text-muted-foreground">No classified fields.</span>
                              ) : (
                                classifiedFields.map(([field, classification]) => (
                                  <div
                                    key={field}
                                    className="flex items-center justify-between gap-3"
                                  >
                                    <span className="truncate text-foreground/75">{field}</span>
                                    <span className="text-muted-foreground">{classification}</span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              JSON Schema
                            </div>
                            <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border/55 bg-background/70 p-3 font-mono text-[10px] leading-4 text-foreground/70">
                              {JSON.stringify(schema.jsonSchema, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </DisclosureRegion>
                    </div>
                  );
                })}
              </div>
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSectionShell title="Delivery diagnostics">
            <SettingsCard>
              {snapshot.deliveries.slice(0, 20).map((delivery) => (
                <SettingsListRow
                  key={delivery.id}
                  title={`${delivery.status} · ${delivery.subscriptionId}`}
                  description={`${delivery.id} · ${delivery.attemptCount} attempts · updated ${new Date(delivery.updatedAt).toLocaleString()}`}
                  actions={value(delivery.replay ? "replay" : "live")}
                />
              ))}
              {snapshot.deadLetters.map((letter) => (
                <SettingsListRow
                  key={letter.id}
                  title={letter.reason}
                  description={`${letter.deliveryId} · ${letter.attemptCount} attempts`}
                  actions={
                    <div className="flex items-center gap-2">
                      {value(letter.status)}
                      {letter.status === "open" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === letter.id}
                          onClick={() => void redriveDeadLetter(letter.id)}
                        >
                          Test observe-only replay
                        </Button>
                      ) : null}
                    </div>
                  }
                />
              ))}
              {snapshot.deliveries.length === 0 && snapshot.deadLetters.length === 0 ? (
                <SettingsEmptyState layout="status">
                  No deliveries or DeadLetters. Durable cursors are healthy.
                </SettingsEmptyState>
              ) : null}
            </SettingsCard>
          </SettingsSectionShell>

          <SettingsSection title="Locked governance invariants">
            <SettingsRow
              title="Command boundary"
              description="Plugins and subscriptions can propose typed commands only; authority, expected revision, idempotency, RunPolicy, and audit still apply."
              control={value("Locked")}
            />
            <SettingsRow
              title="Room acceptance"
              description="Lead retains Room-local integration and acceptance authority after every signal wake or intervention."
              control={value("Locked")}
            />
            <SettingsRow
              title="Permission monotonicity"
              description="Subscriptions, replay, plugins, retained state, and learned patches never expand capability grants."
              control={value("Locked")}
            />
          </SettingsSection>
        </>
      ) : null}
      <div className="min-h-5 text-[11px] text-muted-foreground" aria-live="polite">
        {feedback}
      </div>
    </div>
  );
}
