import type {
  ModelSessionTrace,
  ModelTranscriptItem,
  RlmEpisode,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import type { ReactNode } from "react";

import { isPeerModelSessionRole } from "~/lib/supervisedOrchestration";
import { cn } from "~/lib/utils";

export type ConversationGroup = "supervisor" | "lead" | "peers" | "rlm";

const GROUPS: ReadonlyArray<{ readonly id: ConversationGroup; readonly label: string }> = [
  { id: "supervisor", label: "Supervisor" },
  { id: "lead", label: "Leads" },
  { id: "peers", label: "Peers" },
  { id: "rlm", label: "RLM" },
];

function roleGroup(session: ModelSessionTrace): ConversationGroup {
  if (session.role === "lead") return "lead";
  if (isPeerModelSessionRole(session.role)) return "peers";
  return "rlm";
}

function roleLabel(session: ModelSessionTrace): string {
  if (isPeerModelSessionRole(session.role)) return "Peer";
  switch (session.role) {
    case "lead":
      return "Lead";
    case "rlm_root":
      return "RLM synthesis";
    case "rlm_branch":
      return "RLM branch";
  }
}

function orderRlmSessions(sessions: ReadonlyArray<ModelSessionTrace>): ReadonlyArray<ModelSessionTrace> {
  const byParent = new Map<string, Array<ModelSessionTrace>>();
  const roots: Array<ModelSessionTrace> = [];
  const knownIds = new Set(sessions.map((session) => session.id));

  for (const session of sessions) {
    if (!session.parentSessionId || !knownIds.has(session.parentSessionId)) {
      roots.push(session);
      continue;
    }
    const siblings = byParent.get(session.parentSessionId) ?? [];
    siblings.push(session);
    byParent.set(session.parentSessionId, siblings);
  }

  const sortByTime = (left: ModelSessionTrace, right: ModelSessionTrace) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
  roots.sort(sortByTime);
  for (const siblings of byParent.values()) siblings.sort(sortByTime);

  const ordered: Array<ModelSessionTrace> = [];
  const visited = new Set<string>();
  const append = (session: ModelSessionTrace) => {
    if (visited.has(session.id)) return;
    visited.add(session.id);
    ordered.push(session);
    for (const child of byParent.get(session.id) ?? []) append(child);
  };
  for (const root of roots) append(root);
  for (const session of sessions) append(session);
  return ordered;
}

function sessionDepth(session: ModelSessionTrace, sessions: ReadonlyArray<ModelSessionTrace>): number {
  const byId = new Map(sessions.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<string>();
  let current = session;
  let depth = 0;
  while (current.parentSessionId && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentSessionId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

const statusLabel = (value: string) => value.replaceAll("_", " ");

function RlmEpisodeSummary(props: { readonly episode: RlmEpisode }) {
  const episode = props.episode;
  const admission = episode.admission;
  return (
    <section
      aria-label={`RLM episode ${episode.id}`}
      className="shrink-0 border-b border-border/60 bg-muted/15 px-4 py-3 text-[10px] text-muted-foreground"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="uppercase tracking-[0.14em]">RLM episode receipt</div>
          <div className="mt-1 break-all text-xs font-medium text-foreground">{episode.id}</div>
          <div className="mt-1 break-all">Run {episode.runId} · revision {episode.revision}</div>
        </div>
        <span className="shrink-0 rounded-full border border-border/70 px-2 py-0.5 capitalize text-foreground">
          {statusLabel(episode.status)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border/60 bg-border/60 sm:grid-cols-4">
        {[
          ["Branches", `${episode.completedBranchCount} / ${episode.branchCount}`],
          ["Coverage", `${episode.coveragePercent}%`],
          ["Stale", episode.staleBranchCount.toLocaleString()],
          ["Contradictions", episode.contradictionCount.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--color-background-surface)] px-2.5 py-2">
            <div className="uppercase tracking-[0.1em]">{label}</div>
            <div className="mt-0.5 text-xs font-medium text-foreground">{value}</div>
          </div>
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
        <dt>Mode</dt>
        <dd>{admission.requestedMode} → {admission.selectedMode}</dd>
        <dt>Policy</dt>
        <dd>{admission.admittedByPolicyId}</dd>
        <dt>Estimate</dt>
        <dd>{admission.estimatedInputTokens.toLocaleString()} input tokens · {admission.estimatedContextPercent}% context</dd>
        <dt>Root session</dt>
        <dd>{episode.rootModelSessionId ?? "not supplied"}</dd>
        <dt>Branch sessions</dt>
        <dd>{episode.branchModelSessionIds.length > 0 ? episode.branchModelSessionIds.join(", ") : "not supplied"}</dd>
      </dl>
      {admission.reasons.length > 0 ? (
        <div className="mt-2">Admission · {admission.reasons.join(" · ")}</div>
      ) : null}
      {episode.evidenceRefs.length > 0 ? (
        <div className="mt-2 break-all">Evidence · {episode.evidenceRefs.join(", ")}</div>
      ) : (
        <div className="mt-2">Evidence · none retained yet</div>
      )}
      {episode.failureSummaries.length > 0 ? (
        <ul className="mt-2 space-y-1 border-l-2 border-destructive/50 pl-2 text-destructive">
          {episode.failureSummaries.map((failure, index) => <li key={`${index}:${failure}`}>{failure}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

function TranscriptItem(props: { readonly item: ModelTranscriptItem }) {
  const item = props.item;
  switch (item.type) {
    case "message":
      return (
        <article className={cn("rounded-lg border p-3", item.role === "assistant" && "bg-muted/25")}>
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {item.role === "assistant" ? "Assistant" : "Input"}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground">{item.content}</p>
          {item.reasoningSummary ? (
            <div className="mt-3 border-t border-border/55 pt-2">
              <div className="text-[10px] text-muted-foreground">Provider reasoning summary</div>
              <p className="mt-1 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
                {item.reasoningSummary}
              </p>
            </div>
          ) : null}
        </article>
      );
    case "tool_call":
      return (
        <article className="border-l-2 border-border px-3 py-2">
          <div className="flex items-center justify-between gap-3 text-[11px]">
            <span className="font-medium">Tool call · {item.toolName}</span>
            <span className="capitalize text-muted-foreground">{item.status}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
            {item.inputSummary}
          </p>
        </article>
      );
    case "tool_result":
      return (
        <article className="border-l-2 border-border px-3 py-2">
          <div className="text-[11px] font-medium">Tool result</div>
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-4 text-muted-foreground">
            {item.errorSummary ?? item.outputSummary ?? "No visible output."}
          </p>
        </article>
      );
    case "evidence":
      return (
        <article className="rounded-lg border border-border/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Evidence published
          </div>
          <div className="mt-1 text-xs font-medium">{item.evidenceId}</div>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.summary}</p>
        </article>
      );
    case "kernel_cell":
      return (
        <article className="overflow-hidden rounded-lg border border-border/70">
          <div className="border-b border-border/55 px-3 py-2 text-[10px] text-muted-foreground">
            Kernel · {item.language} · {item.status}
          </div>
          <pre className="overflow-x-auto bg-muted/25 px-3 py-2 text-[11px] leading-4">{item.code}</pre>
          {item.output ? (
            <pre className="overflow-x-auto border-t border-border/55 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
              {item.output}
            </pre>
          ) : null}
        </article>
      );
    case "context_receipt":
      return (
        <article className="rounded-lg border border-dashed border-border/70 p-3 text-[11px]">
          <div className="font-medium">Context · {item.label}</div>
          <div className="mt-1 text-muted-foreground">
            {item.contextRecordIds.length} durable context record
            {item.contextRecordIds.length === 1 ? "" : "s"}
          </div>
        </article>
      );
    case "handoff":
      return (
        <article className="rounded-lg border border-border/70 p-3 text-[11px]">
          <div className="font-medium">Handoff → {item.destination}</div>
          <p className="mt-1 leading-4 text-muted-foreground">{item.summary}</p>
        </article>
      );
  }
}

function SessionTranscript(props: { readonly session: ModelSessionTrace }) {
  const session = props.session;
  const usage = session.usage;
  const contextView = session.contextView;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-[var(--color-background-surface)] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {roleLabel(session)}
            </div>
            <h3 className="mt-1 truncate text-xs font-medium">{session.title}</h3>
          </div>
          <span className="rounded-full border px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
            {session.status}
          </span>
        </div>
        <div className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {session.provider} · {session.model}{session.reasoningEffort ? ` · ${session.reasoningEffort}` : ""} · Run {session.runId}
        </div>
        <details className="mt-2 text-[10px] text-muted-foreground">
          <summary className="cursor-pointer select-none">Session receipts</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
            <dt>Trace</dt><dd>{session.id}</dd>
            <dt>Episode</dt><dd>{session.rlmEpisodeId ?? "not an RLM session"}</dd>
            <dt>Thread</dt><dd>{session.threadId ?? "not supplied"}</dd>
            <dt>Provider session</dt><dd>{session.providerSessionId ?? "not supplied by provider projection"}</dd>
            <dt>Provider call</dt><dd>{session.providerCallId ?? "not supplied"}</dd>
            <dt>Prompt SHA-256</dt><dd>{session.promptHash ?? "not supplied"}</dd>
            <dt>Parent session</dt><dd>{session.parentSessionId ?? (session.rlmEpisodeId ? "none (RLM root session)" : "none")}</dd>
            <dt>Caller seat</dt><dd>{session.actorSeatId ?? "not supplied"}</dd>
            <dt>Authority receipt</dt><dd>{session.authorityReceiptId ?? "not supplied"}</dd>
            <dt>Effective role</dt><dd className="capitalize">{session.effectiveRole ? statusLabel(session.effectiveRole) : "not supplied"}</dd>
            <dt>Root leases</dt><dd>{session.rootLeaseIds.length > 0 ? session.rootLeaseIds.join(", ") : "none (no Root authority)"}</dd>
            <dt>Task</dt><dd>{session.taskId}</dd>
            <dt>TaskNode</dt><dd>{session.taskNodeId ?? "not scoped"}</dd>
            <dt>ContextView</dt><dd>{contextView?.id ?? "not supplied"}</dd>
            <dt>Context actor</dt><dd>{contextView?.actorSeatId ?? "not supplied"}</dd>
          </dl>
        </details>
      </header>
      <div className="space-y-3 p-4">
        <section className="rounded-lg border border-dashed border-border/70 p-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">ContextView / prompt receipt</div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5">{session.inputSummary}</p>
          <div className="mt-2 text-[10px] text-muted-foreground">
            {session.contextViewRefs.length} durable context reference
            {session.contextViewRefs.length === 1 ? "" : "s"}
            {contextView ? ` · ${contextView.estimatedTokens.toLocaleString()} estimated tokens · ${contextView.confidence} confidence` : ""}
          </div>
        </section>
        {session.items.map((item) => <TranscriptItem key={item.id} item={item} />)}
        {session.items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-[11px] text-muted-foreground">
            This session receipt has no model-visible transcript items yet.
          </div>
        ) : null}
      </div>
      <footer className="border-t border-border/60 px-4 py-3 text-[10px] leading-4 text-muted-foreground">
        <div>
          Recorded context {usage.contextUsagePercent === null ? "unknown" : `${usage.contextUsagePercent}%`} · {usage.contextTokens.toLocaleString()}
          {usage.providerLimitTokens ? ` / ${usage.providerLimitTokens.toLocaleString()} tokens` : " tokens"}
        </div>
        <div>Input {usage.inputTokens.toLocaleString()} · output {usage.outputTokens.toLocaleString()} tokens</div>
        <div>
          {session.durationMs === null ? "Duration pending" : `${(session.durationMs / 1_000).toFixed(1)}s`} · {session.retryCount} retries
          {session.costUsd === null ? "" : ` · $${session.costUsd.toFixed(4)}`}
        </div>
        {session.synthesisDestination ? <div>Destination · {session.synthesisDestination}</div> : null}
      </footer>
    </div>
  );
}

function SessionIndex(props: {
  readonly sessions: ReadonlyArray<ModelSessionTrace>;
  readonly selectedSessionId: string | null;
  readonly onSelectSession: (sessionId: string) => void;
  readonly tree?: boolean;
}) {
  return (
    <div className="max-h-44 shrink-0 overflow-y-auto border-b border-border/60 p-2">
      {props.sessions.map((session) => {
        const depth = props.tree ? sessionDepth(session, props.sessions) : 0;
        return (
          <button
            key={session.id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] transition-colors",
              props.selectedSessionId === session.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            style={{ paddingLeft: `${8 + depth * 18}px` }}
            onClick={() => props.onSelectSession(session.id)}
          >
            {props.tree ? <span className="text-muted-foreground">{depth ? "└" : "◇"}</span> : null}
            <span className="size-1.5 shrink-0 rounded-full bg-[var(--color-text-accent)]" />
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            <span className="capitalize">{session.status}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SupervisedConversationsPanel(props: {
  readonly roomId: string;
  readonly snapshot: SupervisedRuntimeSnapshot;
  readonly supervisorConversation: ReactNode | null;
  readonly leadConversation: ReactNode;
  readonly group: ConversationGroup;
  readonly selectedSessionId: string | null;
  readonly onGroupChange: (group: ConversationGroup) => void;
  readonly onSelectSession: (sessionId: string) => void;
}) {
  const roomSessions = props.snapshot.modelSessions
    .filter((session) => session.roomId === props.roomId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const groupedSessions = roomSessions.filter((session) => roleGroup(session) === props.group);
  const sessions = props.group === "rlm" ? orderRlmSessions(groupedSessions) : groupedSessions;
  const selected = sessions.find((session) => session.id === props.selectedSessionId) ?? sessions[0] ?? null;
  const roomRunIds = new Set(
    props.snapshot.runs.filter((run) => run.roomId === props.roomId).map((run) => run.id),
  );
  const roomEpisodeIds = new Set(
    roomSessions.flatMap((session) => session.rlmEpisodeId ? [session.rlmEpisodeId] : []),
  );
  const episodes = props.snapshot.rlmEpisodes
    .filter((episode) => roomRunIds.has(episode.runId) || roomEpisodeIds.has(episode.id))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
  const selectedEpisode =
    (selected?.rlmEpisodeId
      ? episodes.find((episode) => episode.id === selected.rlmEpisodeId)
      : undefined) ?? episodes[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-3" aria-label="Model conversations">
        {GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn(
              "rounded-md px-2.5 py-1.5 text-[10px] transition-colors",
              props.group === item.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            aria-current={props.group === item.id ? "page" : undefined}
            onClick={() => props.onGroupChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {props.group === "rlm" && selectedEpisode ? <RlmEpisodeSummary episode={selectedEpisode} /> : null}
      {props.group === "supervisor" ? (
        props.supervisorConversation ?? (
          <div className="flex min-h-64 flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground">
            No active Supervisor conversation is available for this workspace.
          </div>
        )
      ) : props.group === "lead" && !selected ? (
        <div className="flex min-h-0 flex-1">{props.leadConversation}</div>
      ) : sessions.length === 0 ? (
        <div className="flex min-h-64 flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground">
          No {props.group === "peers" ? "Peer" : "RLM"} model sessions have been recorded for this Room.
        </div>
      ) : (
        <>
          <SessionIndex
            sessions={sessions}
            selectedSessionId={selected?.id ?? null}
            onSelectSession={props.onSelectSession}
            tree={props.group === "rlm"}
          />
          {selected ? <SessionTranscript session={selected} /> : null}
        </>
      )}
    </div>
  );
}
