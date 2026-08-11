import type { HandoffDraftV1 } from "@veylen/contracts";
import { useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

type ContextView = "latest" | "history" | "source";

function ClaimList({ title, claims }: { title: string; claims: ReadonlyArray<{ text: string }> }) {
  if (claims.length === 0) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <ul className="space-y-2 text-sm leading-relaxed">
        {claims.map((claim, index) => (
          <li key={`${title}-${index}`} className="rounded-lg bg-muted/50 px-3 py-2">
            {claim.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HandoffContextDialog(props: {
  readonly open: boolean;
  readonly handoff: HandoffDraftV1;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [view, setView] = useState<ContextView>("latest");
  const packet = props.handoff.packet;
  const runtime = props.handoff.runtime;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Handoff context</DialogTitle>
          <DialogDescription>
            From {props.handoff.sourceTitle}
            {runtime ? ` · ${runtime.model} · ${runtime.effort}` : " · sealed source link"}
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex gap-1 border-y border-border px-4 py-2"
          role="tablist"
          aria-label="Handoff context views"
        >
          {(["latest", "history", "source"] as const).map((candidate) => (
            <Button
              key={candidate}
              type="button"
              size="sm"
              variant={view === candidate ? "secondary" : "ghost"}
              role="tab"
              aria-selected={view === candidate}
              className="min-h-11 flex-1 capitalize sm:min-h-8 sm:flex-none"
              onClick={() => setView(candidate)}
            >
              {candidate === "source" ? "Source access" : candidate}
            </Button>
          ))}
        </div>
        <DialogPanel className="space-y-5 pt-4">
          {view === "latest" ? (
            <>
              {props.handoff.handoffPrompt.trim() ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Handoff prompt
                  </h3>
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm leading-relaxed">
                    {props.handoff.handoffPrompt}
                  </p>
                </section>
              ) : null}
              {packet ? (
                <>
                  <section className="space-y-2">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Objective
                    </h3>
                    <p className="text-sm leading-relaxed">{packet.objective.text}</p>
                  </section>
                  <ClaimList title="Current state" claims={packet.currentState} />
                  <ClaimList title="Accepted decisions" claims={packet.decisions.accepted} />
                  <ClaimList title="Risks" claims={packet.risks} />
                  <ClaimList title="Dissent" claims={packet.dissent} />
                  <ClaimList title="Next actions" claims={packet.nextActions} />
                  {packet.omissions.length > 0 ? (
                    <section className="space-y-2">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Omissions
                      </h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                        {packet.omissions.map((omission) => (
                          <li key={omission}>{omission}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {props.handoff.sourceLinkOnly
                    ? "This destination uses the sealed source capsule without an agent-authored packet."
                    : props.handoff.preparationPhase}
                </p>
              )}
            </>
          ) : null}
          {view === "history" ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-border px-3 py-2">
                <p className="font-medium">Preparation revision 1</p>
                <p className="mt-1 text-muted-foreground">{props.handoff.preparationPhase}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  Attempt {props.handoff.attemptId ?? "interrupted"}
                </p>
              </div>
              {props.handoff.error ? (
                <p className="text-destructive">{props.handoff.error}</p>
              ) : null}
            </div>
          ) : null}
          {view === "source" ? (
            <div className="space-y-5">
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Source thread</dt>
                <dd className="break-all font-mono text-xs">{props.handoff.sourceThreadId}</dd>
                <dt className="text-muted-foreground">Frozen cursor</dt>
                <dd>{props.handoff.sourceCursor}</dd>
                <dt className="text-muted-foreground">Digest</dt>
                <dd className="truncate font-mono text-xs" title={props.handoff.sourceDigest}>
                  {props.handoff.sourceDigest}
                </dd>
                <dt className="text-muted-foreground">Durable grant</dt>
                <dd>Created atomically when the destination sends its first message</dd>
              </dl>
            </div>
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
