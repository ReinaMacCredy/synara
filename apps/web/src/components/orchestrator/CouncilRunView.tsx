import type { OrchestratorArtifact, OrchestratorRun, ThreadId } from "@synara/contracts";
import { useState } from "react";

import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { formatRelativeTime } from "~/lib/relativeTime";

import { FinalDecisionPacketView } from "./FinalDecisionPacketView";
import { threadLabel } from "./orchestratorViewModel";

function artifactRoundLabel(artifact: OrchestratorArtifact): string {
  return artifact.round === null ? "Run artifacts" : `Round ${artifact.round}`;
}

function ArtifactView(props: {
  readonly artifact: OrchestratorArtifact;
  readonly producerLabel: string;
}) {
  const [open, setOpen] = useState(
    props.artifact.kind === "arbiter_verdict" || props.artifact.kind === "revision",
  );
  if (props.artifact.kind === "decision_packet") {
    return <FinalDecisionPacketView artifact={props.artifact} />;
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border/70 bg-background/55">
        <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/40">
          <DisclosureChevron open={open} />
          <span className="truncate text-[11px] font-medium">
            {props.artifact.kind.replaceAll("_", " ")}
          </span>
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">
            {props.producerLabel} · {props.artifact.visibility}
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="border-t border-border/70 px-2.5 py-2">
            <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed">
              {props.artifact.content}
            </p>
            <p className="mt-2 text-[9px] text-muted-foreground">
              {props.artifact.contentHash} · {formatRelativeTime(props.artifact.createdAt)}
            </p>
          </div>
        </CollapsiblePanel>
      </div>
    </Collapsible>
  );
}

export function CouncilRunView(props: {
  readonly run: OrchestratorRun;
  readonly artifacts: readonly OrchestratorArtifact[];
  readonly threadLabels: ReadonlyMap<ThreadId, string>;
}) {
  const attributionReleased = ["converged", "disputed", "packet_published"].includes(
    props.run.state,
  );
  const participantByThreadId = new Map(
    props.run.participants.map((participant) => [participant.threadId, participant] as const),
  );
  const artifactsByRound = new Map<string, OrchestratorArtifact[]>();
  for (const artifact of props.artifacts) {
    const round = artifactRoundLabel(artifact);
    const items = artifactsByRound.get(round) ?? [];
    items.push(artifact);
    artifactsByRound.set(round, items);
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5 rounded-lg bg-muted/35 p-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Sealed Council
        </p>
        {props.run.participants.map((participant) => {
          const anonymous = participant.anonymousLabel ?? participant.role;
          return (
            <div key={participant.threadId} className="flex min-w-0 items-center gap-2 text-[10px]">
              <span className="truncate font-medium">{anonymous}</span>
              <span className="text-muted-foreground">{participant.role.replaceAll("_", " ")}</span>
              {attributionReleased ? (
                <span className="ml-auto truncate text-muted-foreground">
                  {threadLabel(props.threadLabels, participant.threadId)} ·{" "}
                  {participant.modelTarget.provider} / {participant.modelTarget.model}
                </span>
              ) : (
                <span className="ml-auto text-muted-foreground">identity sealed</span>
              )}
            </div>
          );
        })}
      </div>

      {[...artifactsByRound.entries()].map(([round, artifacts]) => (
        <section key={round} className="grid gap-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {round}
          </p>
          {artifacts.map((artifact) => {
            const participant = participantByThreadId.get(artifact.producerThreadId);
            const producerLabel =
              participant?.anonymousLabel ??
              participant?.role ??
              (attributionReleased
                ? threadLabel(props.threadLabels, artifact.producerThreadId)
                : "Sealed participant");
            return (
              <ArtifactView key={artifact.id} artifact={artifact} producerLabel={producerLabel} />
            );
          })}
        </section>
      ))}
    </div>
  );
}
