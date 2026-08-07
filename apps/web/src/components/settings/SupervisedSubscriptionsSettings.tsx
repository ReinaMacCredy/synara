import type {
  AuthorityScope,
  ProjectId,
  RoomId,
  SubscriptionDefinition,
  SupervisedCommand,
} from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { supervisedRuntimeQueryOptions } from "~/lib/supervisedRuntime";
import { makeSupervisedSyntheticEvent } from "~/lib/supervisedSyntheticEvent";
import { readNativeApi } from "~/nativeApi";
import {
  SettingsCard,
  SettingsEmptyState,
  SettingsListRow,
  SettingsSectionShell,
} from "./SettingsPanelPrimitives";

const conditionLabel = (subscription: SubscriptionDefinition) =>
  `${subscription.selector.names.join(" or ")} ${subscription.condition.operator} ${subscription.condition.value}`;

type TriggerKind = "review-loop" | "context-pressure";
type ScopeKind = "global" | "project" | "room";

function destinationLabel(subscription: SubscriptionDefinition): string {
  const destination = subscription.destination;
  if (destination.kind === "lead_seat") return `Lead seat ${destination.leadSeatId}`;
  if (destination.kind === "concern") return `${destination.concern} concern`;
  if (destination.kind === "plugin") return `Plugin ${destination.pluginId}`;
  if (destination.kind === "inbox") return `Inbox ${destination.inbox}`;
  return `Notification ${destination.channel}`;
}

function scopeLabel(subscription: SubscriptionDefinition): string {
  return subscription.scope
    .map((scope) => {
      if (scope.kind === "global") return "Global";
      if (scope.kind === "project") return `Project ${scope.projectId}`;
      if (scope.kind === "room") return `Room ${scope.roomId}`;
      if (scope.kind === "task") return `Task ${scope.taskId}`;
      if (scope.kind === "task_node") return `TaskNode ${scope.taskNodeId}`;
      return `${scope.role} seat ${scope.seatId}`;
    })
    .join(", ");
}

export function SupervisedSubscriptionsSettings(props: { readonly active: boolean }) {
  const query = useQuery({ ...supervisedRuntimeQueryOptions(), enabled: props.active });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [triggerKind, setTriggerKind] = useState<TriggerKind>("context-pressure");
  const [scopeKind, setScopeKind] = useState<ScopeKind>("global");
  const [scopeId, setScopeId] = useState("");
  const [threshold, setThreshold] = useState("80");
  const [windowMinutes, setWindowMinutes] = useState("5");
  const [cooldownMinutes, setCooldownMinutes] = useState("10");
  const [concern, setConcern] = useState("context");
  if (!props.active) return null;

  const changeState = async (
    subscription: SubscriptionDefinition,
    type: "supervised.subscription.pause" | "supervised.subscription.enable" | "supervised.subscription.revoke",
  ) => {
    const api = readNativeApi();
    if (!api) return;
    setBusyId(subscription.id);
    setError(null);
    try {
      await api.orchestration.dispatchCommand({
        type,
        commandId: crypto.randomUUID(),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: subscription.id,
        expectedRevision: subscription.revision,
        idempotencyKey: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        subscriptionId: subscription.id,
      } as SupervisedCommand);
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const createSubscription = async () => {
    const api = readNativeApi();
    if (!api) return;
    const numericThreshold = Number(threshold);
    const numericWindow = Number(windowMinutes);
    const numericCooldown = Number(cooldownMinutes);
    if (
      !Number.isFinite(numericThreshold) ||
      !Number.isFinite(numericWindow) ||
      numericWindow <= 0 ||
      !Number.isFinite(numericCooldown) ||
      numericCooldown < 0 ||
      (scopeKind !== "global" && scopeId.trim().length === 0)
    ) {
      setError("Enter a valid threshold, window, cooldown, and scoped identifier.");
      return;
    }
    const now = new Date().toISOString();
    const id = `subscription:${crypto.randomUUID()}` as SubscriptionDefinition["id"];
    const scope: AuthorityScope =
      scopeKind === "global"
        ? { kind: "global" }
        : scopeKind === "project"
          ? { kind: "project", projectId: scopeId.trim() as ProjectId }
          : { kind: "room", roomId: scopeId.trim() as RoomId };
    const contextRule = triggerKind === "context-pressure";
    const subscription: SubscriptionDefinition = {
      id,
      schemaVersion: "1.0.0",
      name: contextRule ? "Lead context pressure" : "Review loop suspected",
      owner: { kind: "user", actorId: "owner" },
      concern: concern.trim() || (contextRule ? "context" : "delivery"),
      ownerLeadSeatId: null,
      selector: contextRule
        ? { sourceKind: "metric", names: ["contextUsagePercent"] }
        : { sourceKind: "event", names: ["ReviewCompleted", "ReviewRejected"] },
      scope: [scope],
      where: contextRule ? [{ field: "role", operator: "eq", value: "lead" }] : [],
      aggregation: contextRule
        ? { function: "latest", field: "contextUsagePercent", groupBy: ["leadSeatId", "roomId"] }
        : { function: "count", field: null, groupBy: ["taskNodeId", "graphRevision"] },
      window: {
        kind: "sliding",
        durationMs: Math.round(numericWindow * 60_000),
        allowedLatenessMs: 30_000,
        maxSamples: 10_000,
      },
      condition: { operator: contextRule ? "gte" : "gt", value: numericThreshold },
      hysteresis: {
        trigger: { operator: contextRule ? "gte" : "gt", value: numericThreshold },
        reset: contextRule
          ? { operator: "lt", value: Math.max(0, numericThreshold - 15) }
          : { operator: "lte", value: 1 },
      },
      debounceMs: 0,
      cooldownMs: Math.round(numericCooldown * 60_000),
      destination: { kind: "concern", concern: concern.trim() || (contextRule ? "context" : "delivery") },
      allowedActionRequests: contextRule
        ? ["supervised.compaction.request", "supervised.handoff.request"]
        : ["supervised.intervention.propose"],
      cursor: { lastSequence: 0, lastEventTime: null, lastDeliveryKey: null },
      replayPolicy: "observe_only",
      state: "enabled",
      rateLimitPerMinute: 60,
      maxQueueDepth: 1_000,
      failurePolicy: {
        maxAttempts: 3,
        backoffMs: 1_000,
        deadLetterAfterAttempts: 3,
        critical: false,
      },
      armed: true,
      createdBy: { kind: "user", actorId: "owner" },
      updatedBy: { kind: "user", actorId: "owner" },
      createdAt: now,
      updatedAt: now,
      revision: 0,
    };
    setBusyId(id);
    setError(null);
    try {
      await api.orchestration.dispatchCommand({
        type: "supervised.subscription.upsert",
        commandId: crypto.randomUUID(),
        actor: { kind: "user", actorId: "owner" },
        aggregateId: id,
        expectedRevision: 0,
        idempotencyKey: crypto.randomUUID(),
        createdAt: now,
        subscription,
      } as SupervisedCommand);
      await query.refetch();
      setEditorOpen(false);
      setPreview(`${subscription.name} is armed. It observes ${scopeLabel(subscription)} without adding authority.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const testRule = async (subscription: SubscriptionDefinition) => {
    const api = readNativeApi();
    if (!api) return;
    setBusyId(subscription.id);
    setError(null);
    try {
      const result = await api.orchestration.testSupervisedSubscription({
        subscription,
        syntheticEvent: makeSupervisedSyntheticEvent(subscription, "settings-preview"),
      });
      setPreview(
        `${subscription.name}: ${result.wouldTrigger ? "would trigger" : "would not trigger"}. ${result.reasons.join(" ")}`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsSectionShell
      title="Subscriptions & Triggers"
      action={
        <Button size="sm" variant="outline" onClick={() => setEditorOpen((current) => !current)}>
          {editorOpen ? "Cancel" : "New trigger"}
        </Button>
      }
    >
      {editorOpen ? (
        <SettingsCard>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Signal template
              <select
                aria-label="Signal template"
                className="h-9 w-full rounded-lg border border-border bg-transparent px-3 text-xs text-foreground"
                value={triggerKind}
                onChange={(event) => {
                  const value = event.target.value as TriggerKind;
                  setTriggerKind(value);
                  setThreshold(value === "context-pressure" ? "80" : "3");
                  setConcern(value === "context-pressure" ? "context" : "delivery");
                }}
              >
                <option value="context-pressure">Lead context pressure</option>
                <option value="review-loop">Review loop suspected</option>
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Scope
              <select
                aria-label="Subscription scope"
                className="h-9 w-full rounded-lg border border-border bg-transparent px-3 text-xs text-foreground"
                value={scopeKind}
                onChange={(event) => setScopeKind(event.target.value as ScopeKind)}
              >
                <option value="global">Global</option>
                <option value="project">Project</option>
                <option value="room">Lead Room</option>
              </select>
            </label>
            {scopeKind !== "global" ? (
              <label className="space-y-1.5 text-xs text-muted-foreground sm:col-span-2">
                {scopeKind === "project" ? "Project ID" : "Room ID"}
                <Input value={scopeId} onChange={(event) => setScopeId(event.target.value)} />
              </label>
            ) : null}
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Threshold
              <Input inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Window (minutes)
              <Input inputMode="decimal" value={windowMinutes} onChange={(event) => setWindowMinutes(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Cooldown (minutes)
              <Input inputMode="decimal" value={cooldownMinutes} onChange={(event) => setCooldownMinutes(event.target.value)} />
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Destination concern
              <Input value={concern} onChange={(event) => setConcern(event.target.value)} />
            </label>
            <div className="sm:col-span-2 rounded-lg border border-border/65 p-3 text-[11px] leading-4 text-muted-foreground">
              <div className="font-medium text-foreground">Why this will trigger</div>
              <p className="mt-1">
                {triggerKind === "context-pressure"
                  ? `When the latest Lead context measurement is at least ${threshold}% within ${windowMinutes} minutes. It resets below ${Math.max(0, Number(threshold || 0) - 15)}%.`
                  : `When reviews for the same TaskNode and graph revision exceed ${threshold} within ${windowMinutes} minutes.`}
              </p>
              <p className="mt-1">Effective authority: observe, wake, and request an allowed typed action. Lead acceptance authority is unchanged.</p>
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button size="sm" onClick={() => void createSubscription()}>Create & enable</Button>
            </div>
          </div>
        </SettingsCard>
      ) : null}
      {query.isLoading ? (
        <SettingsEmptyState layout="status">Loading governed subscriptions…</SettingsEmptyState>
      ) : query.error ? (
        <SettingsEmptyState layout="status" tone="destructive">
          {query.error instanceof Error ? query.error.message : "Unable to load subscriptions."}
        </SettingsEmptyState>
      ) : (
        <SettingsCard>
          {(query.data?.subscriptions ?? []).map((subscription) => (
            <SettingsListRow
              key={subscription.id}
              title={subscription.name}
              align="start"
              description={
                <div className="space-y-1">
                  <div>{conditionLabel(subscription)} · {subscription.aggregation.function} · {subscription.window.durationMs / 60_000}m window</div>
                  <div>{scopeLabel(subscription)} · deliver to {destinationLabel(subscription)} · reset {subscription.hysteresis.reset.operator} {subscription.hysteresis.reset.value} · cooldown {subscription.cooldownMs / 60_000}m</div>
                  <div>Authority: observe and request [{subscription.allowedActionRequests.join(", ") || "none"}]. No authority transfer.</div>
                  {query.data?.signals.find((signal) => signal.subscriptionId === subscription.id) ? (
                    <div>History: last signal {query.data.signals.find((signal) => signal.subscriptionId === subscription.id)?.state}; delivery {query.data.deliveries.find((delivery) => delivery.subscriptionId === subscription.id)?.status ?? "not queued"}.</div>
                  ) : (
                    <div>History: never fired.</div>
                  )}
                </div>
              }
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-[11px] capitalize text-muted-foreground">
                    {subscription.state}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === subscription.id || subscription.state === "revoked"}
                    onClick={() => void testRule(subscription)}
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === subscription.id || subscription.state === "revoked"}
                    onClick={() =>
                      void changeState(
                        subscription,
                        subscription.state === "enabled"
                          ? "supervised.subscription.pause"
                          : "supervised.subscription.enable",
                      )
                    }
                  >
                    {subscription.state === "enabled" ? "Pause" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === subscription.id || subscription.state === "revoked"}
                    onClick={() => void changeState(subscription, "supervised.subscription.revoke")}
                  >
                    Revoke
                  </Button>
                </div>
              }
            />
          ))}
        </SettingsCard>
      )}
      <div className="mt-2 min-h-5 text-[11px] text-muted-foreground" aria-live="polite">
        {error ? <span className="text-destructive">{error}</span> : preview}
      </div>
    </SettingsSectionShell>
  );
}
