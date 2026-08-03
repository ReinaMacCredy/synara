import type {
  OrchestratorArtifact,
  OrchestratorDomainEvent,
  OrchestratorRun,
  ThreadId,
} from "@synara/contracts";
import { useEffect, useMemo, useState } from "react";

import { ProviderIcon } from "~/components/ProviderIcon";
import { ThreadActivityGlyph, type ThreadActivityState } from "~/components/ThreadActivityGlyph";
import { Button } from "~/components/ui/button";
import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { WorkflowIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";
import { isProviderKind } from "~/providerOrdering";

import { FinalDecisionPacketView } from "./FinalDecisionPacketView";
import styles from "./RunsPanel.module.css";
import {
  councilStageIndex,
  decisionPacketPreview,
  groupRunsForCommandCenter,
  parseArtifactRecord,
  runDisplayTitle,
  runQueueGroup,
  type RunQueueGroup,
} from "./runsViewModel";
import { threadLabel } from "./orchestratorViewModel";

const QUEUE_LABELS: Record<RunQueueGroup, string> = {
  attention: "Needs attention",
  active: "Active now",
  settled: "Recently settled",
};

function runActivityState(run: OrchestratorRun): ThreadActivityState {
  const group = runQueueGroup(run);
  if (group === "attention") return run.state === "blocked" ? "blocked" : "ready";
  if (group === "active") return "working";
  if (run.state === "cancelled") return "failed";
  return "available";
}

function runStatusLabel(run: OrchestratorRun): string {
  if (run.disposition === "owner_review_required" || run.state === "owner_review_required") {
    return "Owner review";
  }
  return run.state.replaceAll("_", " ");
}

function QueueSection(props: {
  readonly group: RunQueueGroup;
  readonly runs: readonly OrchestratorRun[];
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly selectedRunId: string | null;
  readonly onSelectRun: (runId: string) => void;
}) {
  if (props.runs.length === 0) return null;
  return (
    <section className="grid gap-1.5">
      <div className="flex items-center gap-2 px-1">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {QUEUE_LABELS[props.group]}
        </h3>
        <span className="text-[10px] tabular-nums text-muted-foreground">{props.runs.length}</span>
      </div>
      {props.runs.map((run) => {
        const runArtifacts = props.artifacts.filter((artifact) => artifact.runId === run.id);
        return (
          <button
            key={run.id}
            type="button"
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
              props.selectedRunId === run.id
                ? "border-primary/30 bg-primary/5"
                : "border-transparent hover:bg-muted/45",
            )}
            data-run-queue-id={run.id}
            onClick={() => props.onSelectRun(run.id)}
          >
            <ThreadActivityGlyph state={runActivityState(run)} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {runDisplayTitle(run, runArtifacts)}
              </span>
              <span className="mt-0.5 block truncate text-[10px] capitalize text-muted-foreground">
                {runStatusLabel(run)} · {formatRelativeTime(run.updatedAt)}
              </span>
            </span>
          </button>
        );
      })}
    </section>
  );
}

function StageRail(props: { readonly run: OrchestratorRun }) {
  const current = councilStageIndex(props.run.state);
  const labels =
    props.run.mode === "council"
      ? (["Sealed round", "Review", "Verdict"] as const)
      : (["Work", "Review", "Decision"] as const);
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={`${props.run.mode} run stages`}>
      {labels.map((label, index) => {
        const state: ThreadActivityState =
          index < current ? "ready" : index === current ? "working" : "idle";
        const terminal = index === current && runQueueGroup(props.run) !== "active";
        return (
          <li key={label} className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <ThreadActivityGlyph state={terminal ? "ready" : state} className="shrink-0" />
            <span
              className={cn(
                "truncate",
                index <= current ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SeatGrid(props: {
  readonly run: OrchestratorRun;
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
}) {
  const attributionReleased = ["converged", "disputed", "packet_published"].includes(
    props.run.state,
  );
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {props.run.mode === "council" ? "Sealed role seats" : "Participants"}
      </h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {props.run.participants.map((participant) => {
          const reportReady = participant.artifactIds.some((artifactId) =>
            props.artifacts.some((artifact) => artifact.id === artifactId),
          );
          return (
            <article
              key={participant.threadId}
              className="rounded-lg border border-border/70 p-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <ProviderIcon
                  provider={
                    isProviderKind(participant.modelTarget.provider)
                      ? participant.modelTarget.provider
                      : null
                  }
                  className="size-3.5 shrink-0"
                />
                <span className="truncate text-xs font-medium">
                  {participant.anonymousLabel ?? participant.role.replaceAll("_", " ")}
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                  {reportReady ? "Report ready" : "Awaiting report"}
                  <ThreadActivityGlyph state={reportReady ? "ready" : "idle"} />
                </span>
              </div>
              <p className="mt-1 truncate text-[10px] text-muted-foreground">
                {attributionReleased
                  ? `${threadLabel(props.threadLabels, participant.threadId)} · ${participant.modelTarget.model}`
                  : `${participant.role.replaceAll("_", " ")} · identity sealed`}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ClaimLedger(props: { readonly artifacts: readonly OrchestratorArtifact[] }) {
  const ledger = props.artifacts.find((artifact) => artifact.kind === "claim_ledger");
  if (!ledger) {
    return <p className="text-xs text-muted-foreground">No released anonymous claim ledger yet.</p>;
  }
  const record = parseArtifactRecord(ledger);
  const claims = Array.isArray(record?.claims) ? record.claims.slice(0, 8) : [];
  return (
    <section className="rounded-lg border border-border/70 p-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Anonymous claim ledger
        </h3>
        <span className="ml-auto text-[9px] text-muted-foreground">{ledger.contentHash}</span>
      </div>
      {claims.length > 0 ? (
        <ol className="mt-2 grid gap-1.5">
          {claims.map((claim, index) => {
            const item =
              typeof claim === "object" && claim !== null
                ? (claim as Record<string, unknown>)
                : null;
            const text = typeof item?.claim === "string" ? item.claim : JSON.stringify(claim);
            return (
              <li key={`${index}:${text}`} className="text-[10px] leading-relaxed">
                <span className="mr-1 text-muted-foreground">{index + 1}.</span>
                {text}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[10px] leading-relaxed">
          {ledger.content}
        </p>
      )}
    </section>
  );
}

function VerdictPair(props: { readonly artifacts: readonly OrchestratorArtifact[] }) {
  const packet = decisionPacketPreview(props.artifacts);
  const entries = [
    ["Primary", packet?.primaryVerdictArtifactId ?? null],
    ["Shadow", packet?.shadowVerdictArtifactId ?? null],
  ] as const;
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Blind equal-weight verdicts
      </h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {entries.map(([label, artifactId]) => {
          const artifact = artifactId
            ? props.artifacts.find((candidate) => candidate.id === artifactId)
            : null;
          return (
            <article key={label} className="rounded-lg border border-border/70 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{label}</span>
                <span className="ml-auto text-[9px] text-muted-foreground">
                  {artifact ? "Verdict ready" : "Sealed"}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                {artifact?.content ?? "No released verdict is available."}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProtocolCanvas(props: {
  readonly run: OrchestratorRun;
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
}) {
  const packet = props.artifacts.find((artifact) => artifact.kind === "decision_packet") ?? null;
  return (
    <div className="grid content-start gap-5 p-4">
      <header>
        <div className="flex min-w-0 items-center gap-2">
          <WorkflowIcon className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-sm font-semibold">
            {runDisplayTitle(props.run, props.artifacts)}
          </h2>
          <span className="ml-auto rounded-full bg-muted px-2 py-1 text-[9px] capitalize text-muted-foreground">
            {runStatusLabel(props.run)}
          </span>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {props.run.mode === "council" ? "Sealed Council" : "Collaboration"} ·{" "}
          {props.run.participants.length} seats · {props.artifacts.length} artifacts
        </p>
        <p className="mt-1 break-all text-[9px] text-muted-foreground">
          Run {props.run.id}
          {props.run.briefHash ? ` · Brief ${props.run.briefHash}` : ""}
        </p>
      </header>
      <StageRail run={props.run} />
      <SeatGrid run={props.run} artifacts={props.artifacts} threadLabels={props.threadLabels} />
      <ClaimLedger artifacts={props.artifacts} />
      <VerdictPair artifacts={props.artifacts} />
      {packet ? <FinalDecisionPacketView artifact={packet} /> : null}
    </div>
  );
}

function actorLabel(event: OrchestratorDomainEvent): string {
  const actor = event.payload.actor;
  if (actor.kind === "thread") return `thread ${actor.threadId}`;
  return `${actor.kind} ${actor.actorId}`;
}

function EvidenceInspector(props: {
  readonly run: OrchestratorRun;
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly auditEvents: readonly OrchestratorDomainEvent[];
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const packet = props.artifacts.find((artifact) => artifact.kind === "decision_packet") ?? null;
  const claimLedger = props.artifacts.find((artifact) => artifact.kind === "claim_ledger") ?? null;
  const verdicts = props.artifacts.filter((artifact) => artifact.kind === "arbiter_verdict");
  return (
    <div className="grid content-start gap-4 p-3">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Selected run
        </p>
        <p className="mt-1 truncate text-xs font-medium">
          {runDisplayTitle(props.run, props.artifacts)}
        </p>
        <p className="mt-1 text-[10px] capitalize text-muted-foreground">
          {runStatusLabel(props.run)}
        </p>
      </header>
      <section className="grid gap-2 text-[10px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Claims</span>
          <span>{claimLedger ? "Ledger available" : "Not released"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Verdicts</span>
          <span>{verdicts.length} released</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Evidence</span>
          <span>
            {props.artifacts.filter((artifact) => artifact.kind === "evidence").length} artifacts
          </span>
        </div>
      </section>
      <section className="rounded-lg border border-border/70 p-2.5 text-[10px]">
        <p className="font-medium">Immutable hashes</p>
        <p className="mt-2 break-all text-muted-foreground">
          Brief · {props.run.briefHash ?? "Not sealed"}
        </p>
        <p className="mt-1 break-all text-muted-foreground">
          Packet · {packet?.contentHash ?? "Not published"}
        </p>
      </section>
      <Button
        size="sm"
        variant="outline"
        disabled
        title="Full-packet detail remains a separate design scope"
      >
        Open full packet
      </Button>
      <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
        <div className="rounded-lg border border-border/70">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40">
            <DisclosureChevron open={auditOpen} />
            <span className="text-xs font-medium">Audit ledger</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {props.auditEvents.length}
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <ol className="grid max-h-80 gap-1 overflow-y-auto border-t border-border/70 p-2">
              {props.auditEvents.length === 0 ? (
                <li className="text-[10px] text-muted-foreground">No audit events loaded.</li>
              ) : (
                props.auditEvents.map((event) => (
                  <li key={event.eventId} className="rounded-md bg-muted/35 p-2 text-[10px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{event.type}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        #{event.sequence}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {actorLabel(event)} · {formatRelativeTime(event.occurredAt)}
                    </p>
                  </li>
                ))
              )}
            </ol>
          </CollapsiblePanel>
        </div>
      </Collapsible>
    </div>
  );
}

export function RunsPanel(props: {
  readonly runs: readonly OrchestratorRun[];
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly auditEvents: readonly OrchestratorDomainEvent[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly loading: boolean;
  readonly error: string | null;
}) {
  const groups = useMemo(() => groupRunsForCommandCenter(props.runs), [props.runs]);
  const firstRun = groups.attention[0] ?? groups.active[0] ?? groups.settled[0] ?? null;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(firstRun?.id ?? null);
  useEffect(() => {
    if (selectedRunId && props.runs.some((run) => run.id === selectedRunId)) return;
    setSelectedRunId(firstRun?.id ?? null);
  }, [firstRun?.id, props.runs, selectedRunId]);
  const selectedRun = props.runs.find((run) => run.id === selectedRunId) ?? firstRun;
  const selectedArtifacts = selectedRun
    ? props.artifacts.filter((artifact) => artifact.runId === selectedRun.id)
    : [];
  const selectedAudit = selectedRun
    ? props.auditEvents.filter(
        (event) =>
          event.payload.run?.id === selectedRun.id ||
          event.payload.artifact?.runId === selectedRun.id ||
          event.payload.message?.runId === selectedRun.id,
      )
    : [];

  return (
    <div
      className={cn("flex h-full min-h-0 w-full min-w-0 flex-col", styles.root)}
      data-orchestrator-panel="runs"
    >
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-xs font-medium">Runs</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Canonical run attention, sealed protocol state, and immutable evidence.
        </p>
      </div>
      {props.loading ? <p className="p-4 text-xs text-muted-foreground">Loading runs…</p> : null}
      {props.error ? (
        <p role="alert" className="p-4 text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
      {!props.loading && !props.error && !selectedRun ? (
        <p className="p-4 text-xs text-muted-foreground">No collaboration or Council runs yet.</p>
      ) : null}
      {selectedRun ? (
        <div className={cn("min-h-0 flex-1 overflow-y-auto", styles.layout)}>
          <aside
            className={cn("grid content-start gap-4 p-3", styles.queue)}
            aria-label="Run queue"
          >
            <QueueSection
              group="attention"
              runs={groups.attention}
              artifacts={props.artifacts}
              selectedRunId={selectedRun.id}
              onSelectRun={setSelectedRunId}
            />
            <QueueSection
              group="active"
              runs={groups.active}
              artifacts={props.artifacts}
              selectedRunId={selectedRun.id}
              onSelectRun={setSelectedRunId}
            />
            <QueueSection
              group="settled"
              runs={groups.settled}
              artifacts={props.artifacts}
              selectedRunId={selectedRun.id}
              onSelectRun={setSelectedRunId}
            />
          </aside>
          <main className={styles.canvas} data-selected-run-id={selectedRun.id}>
            <ProtocolCanvas
              run={selectedRun}
              artifacts={selectedArtifacts}
              threadLabels={props.threadLabels}
            />
          </main>
          <aside className={styles.evidence} aria-label="Selected run evidence">
            <EvidenceInspector
              run={selectedRun}
              artifacts={selectedArtifacts}
              auditEvents={selectedAudit}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
