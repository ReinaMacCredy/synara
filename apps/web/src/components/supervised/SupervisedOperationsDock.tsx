import type {
  DerivedSignal,
  SubscriptionDefinition,
  SupervisedRuntimeSnapshot,
} from "@veylen/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { supervisedRuntimeQueryOptions } from "~/lib/supervisedRuntime";
import { isPeerModelSessionRole } from "~/lib/supervisedOrchestration";
import { makeSupervisedSyntheticEvent } from "~/lib/supervisedSyntheticEvent";
import { readNativeApi } from "~/nativeApi";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  SupervisedConversationsPanel,
  type ConversationGroup,
} from "./SupervisedConversationsPanel";
import type { SupervisedTopologyOpenTarget } from "./SupervisedTopologyView";

type OperationsTab = "activity" | "conversation" | "task-graph" | "history";
type ActivityFilter = "facts" | "observations" | "signals" | "commands";

const OPERATIONS_TABS: ReadonlyArray<{ id: OperationsTab; label: string }> = [
  { id: "activity", label: "Activity" },
  { id: "conversation", label: "Conversations" },
  { id: "task-graph", label: "Task graph" },
  { id: "history", label: "History" },
];

const ACTIVITY_FILTERS: ReadonlyArray<{ id: ActivityFilter; label: string }> = [
  { id: "facts", label: "Facts" },
  { id: "observations", label: "Observations" },
  { id: "signals", label: "Signals" },
  { id: "commands", label: "Commands" },
];

export function conversationGroupForTopologyTarget(
  target: SupervisedTopologyOpenTarget,
): ConversationGroup | null {
  switch (target.kind) {
    case "runtime":
      return null;
    case "supervisor":
      return "supervisor";
    case "lead":
      return "lead";
    case "peer":
      return "peers";
  }
}

function scopeLabel(signal: DerivedSignal): string {
  const scope = signal.scope;
  switch (scope.kind) {
    case "global":
      return "Global";
    case "project":
      return `project · ${scope.projectId}`;
    case "room":
      return `room · ${scope.roomId}`;
    case "task":
      return `task · ${scope.taskId}`;
    case "task_node":
      return `task node · ${scope.taskNodeId}`;
    case "seat":
      return `${scope.role} seat · ${scope.seatId}`;
  }
}

function signalAppliesToRoom(signal: DerivedSignal, roomId: string): boolean {
  if (signal.scope.kind === "global") return true;
  if (signal.scope.kind === "room") return signal.scope.roomId === roomId;
  return signal.subjectId === roomId;
}

function deliveryLabel(snapshot: SupervisedRuntimeSnapshot, signal: DerivedSignal): string {
  const delivery = snapshot.deliveries.find((candidate) => candidate.signalId === signal.id);
  return delivery?.status ?? "not queued";
}

function thresholdLabel(signal: DerivedSignal): string {
  return `${signal.threshold.operator} ${signal.threshold.value}`;
}

function destinationLabel(subscription: SubscriptionDefinition | undefined): string {
  if (!subscription) return "Unresolved recipient";
  const destination = subscription.destination;
  switch (destination.kind) {
    case "lead_seat":
      return `Lead · ${destination.leadSeatId}`;
    case "concern":
      return `${destination.concern} control-plane concern`;
    case "inbox":
      return `Inbox · ${destination.inbox}`;
    case "notification":
      return `Notification · ${destination.channel}`;
    case "plugin":
      return `Plugin · ${destination.pluginId}`;
  }
}

function signalTitle(signal: DerivedSignal): string {
  switch (signal.kind) {
    case "ReviewLoopSuspected":
      return "Review loop suspected";
    case "ContextPressureHigh":
      return "Lead context pressure high";
    case "RunProgressStalled":
      return "Run progress stalled";
    case "BudgetBurnAnomaly":
      return "Budget burn anomaly";
    case "RepeatedFailureDetected":
      return "Repeated failure detected";
    case "PluginDeliveryUnhealthy":
      return "Plugin delivery unhealthy";
    default:
      return signal.kind.replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll(/[._-]+/g, " ");
  }
}

function SignalRow(props: {
  readonly signal: DerivedSignal;
  readonly snapshot: SupervisedRuntimeSnapshot;
  readonly preview?: boolean;
}) {
  const subscription = props.snapshot.subscriptions.find(
    (candidate) => candidate.id === props.signal.subscriptionId,
  );
  const delivery = props.snapshot.deliveries.find(
    (candidate) => candidate.signalId === props.signal.id,
  );
  return (
    <article className="border-b border-border/55 px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-text-accent)]" />
            <h3 className="truncate text-xs font-medium text-foreground">
              {signalTitle(props.signal)}
            </h3>
            {props.preview ? (
              <span className="rounded border border-border/70 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                Preview
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
            Measured {props.signal.measuredValue} · threshold {thresholdLabel(props.signal)} ·{" "}
            {scopeLabel(props.signal)}
          </p>
        </div>
        <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
          {props.signal.state}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground/75">
        <span>
          {props.signal.sourceEventIds.length} source event
          {props.signal.sourceEventIds.length === 1 ? "" : "s"}
        </span>
        <span>{destinationLabel(subscription)}</span>
        <span>
          Delivery {props.preview ? "suppressed" : deliveryLabel(props.snapshot, props.signal)}
        </span>
        {subscription ? (
          <span>Cooldown {Math.round(subscription.cooldownMs / 60_000)}m</span>
        ) : null}
        {subscription?.allowedActionRequests[0] ? (
          <span>May request {subscription.allowedActionRequests[0]}</span>
        ) : (
          <span>Evidence only</span>
        )}
        <span>{new Date(props.signal.triggeredAt).toLocaleTimeString()}</span>
      </div>
      <Collapsible>
        <CollapsibleTrigger className="mt-2 text-[10px] font-medium text-muted-foreground hover:text-foreground">
          Inspect trace
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <dl className="mt-2 grid gap-1.5 rounded-md border border-border/55 bg-background/35 p-2 text-[10px] leading-4 text-muted-foreground">
            <div>
              <dt className="inline font-medium text-foreground/80">Source events: </dt>
              <dd className="inline break-all">
                {props.signal.sourceEventIds.join(", ") || "none"}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground/80">Metric samples: </dt>
              <dd className="inline break-all">
                {props.signal.metricSampleIds.join(", ") || "none"}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground/80">Aggregation receipt: </dt>
              <dd className="inline break-all">{props.signal.aggregationReceiptHash}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-foreground/80">Delivery: </dt>
              <dd className="inline break-all">
                {delivery
                  ? `${delivery.id} · ${delivery.status} · ${delivery.attemptCount} attempt${delivery.attemptCount === 1 ? "" : "s"}`
                  : props.preview
                    ? "suppressed by synthetic test"
                    : "not queued"}
              </dd>
            </div>
          </dl>
        </CollapsiblePanel>
      </Collapsible>
    </article>
  );
}

function OperationalRow(props: {
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly at: string;
}) {
  return (
    <article className="border-b border-border/55 px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-xs font-medium text-foreground">{props.title}</h3>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{props.description}</p>
        </div>
        <span className="shrink-0 text-[10px] capitalize text-muted-foreground">
          {props.status}
        </span>
      </div>
      <div className="mt-2 text-[10px] text-muted-foreground/75">
        {new Date(props.at).toLocaleString()}
      </div>
    </article>
  );
}

function ActivityPanel(props: {
  readonly roomId: string;
  readonly snapshot: SupervisedRuntimeSnapshot;
}) {
  const [filter, setFilter] = useState<ActivityFilter>("signals");
  const [previewSignal, setPreviewSignal] = useState<DerivedSignal | null>(null);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const signals = useMemo(
    () => props.snapshot.signals.filter((signal) => signalAppliesToRoom(signal, props.roomId)),
    [props.roomId, props.snapshot.signals],
  );
  const taskIds = useMemo(
    () =>
      new Set(
        props.snapshot.tasks.filter((task) => task.roomId === props.roomId).map((task) => task.id),
      ),
    [props.roomId, props.snapshot.tasks],
  );
  const facts = useMemo(
    () => [
      ...props.snapshot.tasks
        .filter((task) => task.roomId === props.roomId)
        .map((task) => ({
          id: `task:${task.id}`,
          title: task.title,
          description: `Task · graph revision ${task.activeGraphRevision} · ${task.acceptanceCriteria.length} acceptance criteria`,
          status: task.lifecycle,
          at: task.updatedAt,
        })),
      ...props.snapshot.runs
        .filter((run) => run.roomId === props.roomId || taskIds.has(run.taskId))
        .map((run) => ({
          id: `run:${run.id}`,
          title: `Run ${run.id}`,
          description: `Attempt ${run.attempt} · owner ${run.ownerSeatId} · daemon epoch ${run.daemonEpoch}`,
          status: run.status,
          at: run.updatedAt,
        })),
      ...(props.snapshot.interventions ?? [])
        .filter((intervention) => intervention.roomId === props.roomId)
        .map((intervention) => ({
          id: `intervention:${intervention.id}`,
          title: "Governed intervention",
          description: `${intervention.requestedBy.actorId} → Peer ${intervention.specialistThreadId} · Lead notification and reconciliation are durable`,
          status: intervention.status,
          at: intervention.updatedAt,
        })),
    ],
    [
      props.roomId,
      props.snapshot.interventions,
      props.snapshot.runs,
      props.snapshot.tasks,
      taskIds,
    ],
  );
  const observations = useMemo(
    () =>
      (props.snapshot.contextRecords ?? [])
        .filter(
          (record) =>
            record.scope.kind === "global" ||
            (record.scope.kind === "room" && record.scope.roomId === props.roomId),
        )
        .map((record) => ({
          id: `context:${record.id}`,
          title: record.title,
          description: `${record.kind} observation · context revision ${record.contentRevision} · ${record.sourceEventIds.length} source events`,
          status: record.status,
          at: record.updatedAt,
        })),
    [props.roomId, props.snapshot.contextRecords],
  );
  const commands = useMemo(
    () =>
      (props.snapshot.audit ?? []).slice(0, 50).map((entry) => ({
        id: `audit:${entry.sequence}`,
        title: entry.action,
        description: `${entry.actor.kind} ${entry.actor.actorId} · ${entry.targetKind} ${entry.targetId}`,
        status: entry.outcome,
        at: entry.occurredAt,
      })),
    [props.snapshot.audit],
  );

  const runSyntheticTest = async () => {
    const api = readNativeApi();
    const subscription = props.snapshot.subscriptions.find(
      (candidate) => candidate.state === "enabled",
    );
    if (!api || !subscription) return;
    setTesting(true);
    setTestError(null);
    try {
      const result = await api.orchestration.testSupervisedSubscription({
        subscription,
        syntheticEvent: makeSupervisedSyntheticEvent(subscription, "room-view-preview"),
      });
      setPreviewSignal(result.hypotheticalSignal);
      if (!result.wouldTrigger) {
        setTestError(
          `${subscription.name}: ${result.reasons.join(" ") || "The sample did not cross the rule threshold."}`,
        );
      }
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/55 px-3 py-2">
        {ACTIVITY_FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={filter === item.id}
            className={cn(
              "rounded-md px-2 py-1 text-[10px] transition-colors",
              filter === item.id
                ? "bg-[var(--color-background-button-secondary-hover)] text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filter === "facts" && facts.length > 0 ? (
          facts.map((fact) => <OperationalRow key={fact.id} {...fact} />)
        ) : filter === "observations" && observations.length > 0 ? (
          observations.map((observation) => (
            <OperationalRow key={observation.id} {...observation} />
          ))
        ) : filter === "commands" && commands.length > 0 ? (
          commands.map((command) => <OperationalRow key={command.id} {...command} />)
        ) : filter === "signals" && (previewSignal || signals.length > 0) ? (
          <>
            {previewSignal ? (
              <SignalRow signal={previewSignal} snapshot={props.snapshot} preview />
            ) : null}
            {signals.map((signal) => (
              <SignalRow key={signal.id} signal={signal} snapshot={props.snapshot} />
            ))}
          </>
        ) : (
          <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              {filter === "signals"
                ? "No governed signals have fired for this Room."
                : `No summarized ${filter} for this Room.`}
            </p>
            {filter === "signals" && props.snapshot.subscriptions.length > 0 ? (
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                disabled={testing}
                onClick={() => void runSyntheticTest()}
              >
                {testing ? "Testing…" : "Test a subscription"}
              </Button>
            ) : null}
            {testError ? <p className="mt-2 text-[10px] text-destructive">{testError}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskGraphPanel(props: {
  readonly roomId: string;
  readonly snapshot: SupervisedRuntimeSnapshot;
  readonly onOpenTranscript: (taskNodeId: string) => void;
}) {
  const tasks = props.snapshot.tasks.filter((task) => task.roomId === props.roomId);
  const nodes = props.snapshot.taskNodes.filter((node) => node.roomId === props.roomId);
  if (tasks.length === 0) {
    return (
      <div className="flex h-full min-h-64 items-center justify-center px-8 text-center text-xs text-muted-foreground">
        Task graph becomes available after the Lead commits the first Task.
      </div>
    );
  }
  return (
    <div className="space-y-3 overflow-y-auto p-4">
      {tasks.map((task) => (
        <section key={task.id} className="rounded-lg border border-border/65 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium">{task.title}</h3>
            <span className="text-[10px] capitalize text-muted-foreground">{task.lifecycle}</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {nodes
              .filter((node) => node.taskId === task.id)
              .map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                  disabled={
                    !(props.snapshot.modelSessions ?? []).some(
                      (session) => session.taskNodeId === node.id,
                    )
                  }
                  title={
                    (props.snapshot.modelSessions ?? []).some(
                      (session) => session.taskNodeId === node.id,
                    )
                      ? "Open the model transcript that executed this TaskNode"
                      : "No model session receipt has been recorded for this TaskNode"
                  }
                  onClick={() => props.onOpenTranscript(node.id)}
                >
                  <span className="size-1.5 rounded-full bg-muted-foreground/55" />
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                  <span className="capitalize">{node.lifecycle}</span>
                </button>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function SupervisedOperationsDock(props: {
  readonly roomId: string;
  readonly conversation: ReactNode;
  readonly supervisorConversation?: ReactNode;
  readonly navigationRequest?:
    | (SupervisedTopologyOpenTarget & { readonly requestId: number })
    | undefined;
}) {
  const [tab, setTab] = useState<OperationsTab>("activity");
  const [conversationGroup, setConversationGroup] = useState<ConversationGroup>("supervisor");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const query = useQuery(supervisedRuntimeQueryOptions());
  useEffect(() => {
    const request = props.navigationRequest;
    if (!request) return;
    const targetGroup = conversationGroupForTopologyTarget(request);
    if (targetGroup === null) {
      setTab("activity");
      return;
    }
    setConversationGroup(targetGroup);
    setSelectedSessionId(request.sessionId);
    setTab("conversation");
  }, [props.navigationRequest]);
  const openTaskNodeTranscript = (taskNodeId: string) => {
    const session = (query.data?.modelSessions ?? [])
      .filter((candidate) => candidate.taskNodeId === taskNodeId)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!session) return;
    setConversationGroup(
      session.role === "lead" ? "lead" : isPeerModelSessionRole(session.role) ? "peers" : "rlm",
    );
    setSelectedSessionId(session.id);
    setTab("conversation");
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-surface)]">
      <nav
        className="flex h-11 shrink-0 items-end gap-4 border-b border-border/60 px-4"
        aria-label="Room operations"
      >
        {OPERATIONS_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "relative h-full pt-1 text-[11px] transition-colors",
              tab === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {tab === item.id ? (
              <span className="absolute inset-x-0 bottom-0 h-px bg-foreground" />
            ) : null}
          </button>
        ))}
      </nav>
      {!query.data ? (
        <div className="flex min-h-64 flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
          {query.isLoading ? "Loading durable Room state…" : "Supervised runtime is unavailable."}
        </div>
      ) : tab === "conversation" ? (
        <SupervisedConversationsPanel
          roomId={props.roomId}
          snapshot={query.data}
          supervisorConversation={props.supervisorConversation ?? null}
          leadConversation={props.conversation}
          group={conversationGroup}
          selectedSessionId={selectedSessionId}
          onGroupChange={(group) => {
            setConversationGroup(group);
            setSelectedSessionId(null);
          }}
          onSelectSession={setSelectedSessionId}
        />
      ) : tab === "activity" ? (
        <ActivityPanel roomId={props.roomId} snapshot={query.data} />
      ) : tab === "task-graph" ? (
        <TaskGraphPanel
          roomId={props.roomId}
          snapshot={query.data}
          onOpenTranscript={openTaskNodeTranscript}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-lg border border-border/65 p-3">
            <div className="text-xs font-medium">Durable cursor</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Sequence {query.data.snapshotSequence} · daemon epoch {query.data.health.daemonEpoch}
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border/65 p-3">
            <div className="text-xs font-medium">Delivery state</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {query.data.deliveries.length} deliveries · {query.data.deadLetters.length}{" "}
              DeadLetters
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
