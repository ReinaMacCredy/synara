import type {
  OrchestratorArtifact,
  OrchestratorDomainEvent,
  OrchestratorRun,
  ThreadId,
} from "@synara/contracts";
import { useState } from "react";

import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { WorkflowIcon } from "~/lib/icons";
import { formatRelativeTime } from "~/lib/relativeTime";
import { cn } from "~/lib/utils";

import { CouncilRunView } from "./CouncilRunView";
import { FinalDecisionPacketView } from "./FinalDecisionPacketView";
import { threadLabel } from "./orchestratorViewModel";

function CollaborationRunView(props: {
  readonly run: OrchestratorRun;
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
}) {
  const packet = props.artifacts.find((artifact) => artifact.kind === "decision_packet") ?? null;
  return (
    <div className="grid gap-2">
      <div className="grid gap-1 rounded-lg bg-muted/35 p-2 text-[10px]">
        {props.run.participants.map((participant) => (
          <div key={participant.threadId} className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">
              {threadLabel(props.threadLabels, participant.threadId)}
            </span>
            <span className="text-muted-foreground">{participant.role.replaceAll("_", " ")}</span>
            <span className="ml-auto truncate text-muted-foreground">
              {participant.modelTarget.provider} / {participant.modelTarget.model}
            </span>
          </div>
        ))}
      </div>
      {props.artifacts
        .filter((artifact) => artifact.kind !== "decision_packet")
        .map((artifact) => (
          <article key={artifact.id} className="rounded-lg border border-border/70 p-2">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {artifact.kind.replaceAll("_", " ")}
              </span>
              <span className="ml-auto">{artifact.visibility}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed">
              {artifact.content}
            </p>
          </article>
        ))}
      {packet ? <FinalDecisionPacketView artifact={packet} /> : null}
    </div>
  );
}

function RunView(props: {
  readonly run: OrchestratorRun;
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen);
  const exceptional =
    props.run.state === "blocked" ||
    props.run.state === "disputed" ||
    props.run.disposition === "owner_review_required";
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/70">
        <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40">
          <DisclosureChevron open={open} />
          <WorkflowIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs font-medium">
            {props.run.mode === "council" ? "Council" : "Collaboration"} · {props.run.id}
          </span>
          <span
            className={cn(
              "ml-auto rounded-full px-1.5 py-0.5 text-[9px]",
              exceptional ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground",
            )}
          >
            {props.run.state.replaceAll("_", " ")}
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="grid gap-2 border-t border-border/70 p-2">
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span>{props.run.participants.length} participants</span>
              <span>{props.artifacts.length} artifacts</span>
              <span>{formatRelativeTime(props.run.updatedAt)}</span>
              {props.run.disposition ? <span>Disposition {props.run.disposition}</span> : null}
            </div>
            {props.run.mode === "council" ? (
              <CouncilRunView
                run={props.run}
                artifacts={props.artifacts}
                threadLabels={props.threadLabels}
              />
            ) : (
              <CollaborationRunView
                run={props.run}
                artifacts={props.artifacts}
                threadLabels={props.threadLabels}
              />
            )}
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

function actorLabel(event: OrchestratorDomainEvent): string {
  const actor = event.payload.actor;
  if (actor.kind === "thread") return `thread ${actor.threadId}`;
  return `${actor.kind} ${actor.actorId}`;
}

export function RunsPanel(props: {
  readonly runs: readonly OrchestratorRun[];
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly auditEvents: readonly OrchestratorDomainEvent[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
  readonly loading: boolean;
  readonly error: string | null;
}) {
  const [auditOpen, setAuditOpen] = useState(false);
  const runs = props.runs.toSorted(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );
  return (
    <div className="flex h-full min-h-0 flex-col" data-orchestrator-panel="runs">
      <div className="border-b border-border/70 px-3 py-2">
        <p className="text-xs font-medium">Collaboration and Council runs</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Sealed rounds, independent verdicts, disposition, and decision packets.
        </p>
      </div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto p-2">
        {props.loading ? (
          <p className="p-2 text-xs text-muted-foreground">Loading run artifacts…</p>
        ) : null}
        {props.error ? (
          <p role="alert" className="p-2 text-xs text-destructive">
            {props.error}
          </p>
        ) : null}
        {!props.loading && !props.error && runs.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">No collaboration or Council runs yet.</p>
        ) : null}
        {runs.map((run, index) => (
          <RunView
            key={run.id}
            run={run}
            artifacts={props.artifacts.filter((artifact) => artifact.runId === run.id)}
            threadLabels={props.threadLabels}
            defaultOpen={index === 0}
          />
        ))}

        <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
          <div className="rounded-lg border border-border/70">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40">
              <DisclosureChevron open={auditOpen} />
              <span className="text-xs font-medium">Full audit ledger</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {props.auditEvents.length}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ol className="grid max-h-96 gap-1 overflow-y-auto border-t border-border/70 p-2">
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
                        {actorLabel(event)} · revision {event.payload.acceptedRevision} ·{" "}
                        {formatRelativeTime(event.occurredAt)}
                      </p>
                      {event.payload.reason ? (
                        <p className="mt-1 whitespace-pre-wrap">{event.payload.reason}</p>
                      ) : null}
                    </li>
                  ))
                )}
              </ol>
            </CollapsiblePanel>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}
