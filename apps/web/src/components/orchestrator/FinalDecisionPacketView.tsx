import type { OrchestratorArtifact } from "@synara/contracts";
import { useState } from "react";

import { DisclosureChevron } from "~/components/ui/DisclosureChevron";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";

interface DecisionPacketSummary {
  readonly status?: unknown;
  readonly decision?: unknown;
  readonly goal?: unknown;
  readonly materialDissent?: unknown;
  readonly unresolvedRisks?: unknown;
}

function parsePacket(content: string): DecisionPacketSummary | null {
  try {
    const value: unknown = JSON.parse(content);
    return typeof value === "object" && value !== null ? (value as DecisionPacketSummary) : null;
  } catch {
    return null;
  }
}

function readable(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && value.length > 0) {
    return value
      .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
      .join(" · ");
  }
  return null;
}

export function FinalDecisionPacketView(props: { readonly artifact: OrchestratorArtifact }) {
  const [auditOpen, setAuditOpen] = useState(false);
  const packet = parsePacket(props.artifact.content);
  const status = readable(packet?.status);
  const decision = readable(packet?.decision);
  const goal = readable(packet?.goal);
  const dissent = readable(packet?.materialDissent);
  const risks = readable(packet?.unresolvedRisks);

  return (
    <section
      className="rounded-lg border border-primary/25 bg-primary/5 p-2.5"
      data-decision-packet
    >
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold">Final Decision Packet</p>
        {status ? (
          <span className="ml-auto rounded-full bg-background px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
            {status}
          </span>
        ) : null}
      </div>
      {goal ? <p className="mt-2 text-[10px] text-muted-foreground">Goal · {goal}</p> : null}
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed">
        {decision ?? props.artifact.content.slice(0, 700)}
      </p>
      {dissent ? (
        <p className="mt-2 text-[10px] text-warning">Material dissent · {dissent}</p>
      ) : null}
      {risks ? <p className="mt-1 text-[10px] text-warning">Unresolved risks · {risks}</p> : null}
      <Collapsible open={auditOpen} onOpenChange={setAuditOpen}>
        <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground">
          <DisclosureChevron open={auditOpen} />
          Full packet audit
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background/75 p-2 text-[10px] leading-relaxed">
            {props.artifact.content}
          </pre>
        </CollapsiblePanel>
      </Collapsible>
    </section>
  );
}
