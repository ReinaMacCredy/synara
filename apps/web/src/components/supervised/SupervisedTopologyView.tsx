import type { AuthorityScope, SupervisedRuntimeSnapshot } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { supervisedRuntimeQueryOptions } from "~/lib/supervisedRuntime";
import { cn } from "~/lib/utils";
import { GitBranchIcon, MinusIcon, PlusIcon } from "~/lib/icons";
import { useTheme } from "~/hooks/useTheme";

type TopologyNodeKind = "runtime" | "policy" | "lead" | "specialist" | "workspace";

interface TopologyNode {
  readonly id: string;
  readonly kind: TopologyNodeKind;
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly status: string;
}

interface RoomTopologyProjection {
  readonly roomTitle: string;
  readonly roomStatus: string;
  readonly graphRevision: number;
  readonly nodes: ReadonlyArray<TopologyNode>;
  readonly workspaceId: string | null;
  readonly taskCount: number;
  readonly activeRunCount: number;
  readonly policy: SupervisedRuntimeSnapshot["runPolicies"][number] | null;
  readonly contextRecordCount: number;
  readonly contextSequence: number;
}

function scopeAppliesToRoom(
  scope: AuthorityScope,
  roomId: string,
  projectId: string,
  taskIds: ReadonlySet<string>,
  taskNodeIds: ReadonlySet<string>,
): boolean {
  switch (scope.kind) {
    case "global":
      return true;
    case "project":
      return scope.projectId === projectId;
    case "room":
      return scope.roomId === roomId;
    case "task":
      return taskIds.has(scope.taskId);
    case "task_node":
      return taskNodeIds.has(scope.taskNodeId);
    case "seat":
      return false;
  }
}

function buildRoomTopology(
  snapshot: SupervisedRuntimeSnapshot,
  roomId: string,
): RoomTopologyProjection | null {
  const room = snapshot.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return null;

  const tasks = snapshot.tasks.filter((task) => task.roomId === roomId);
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskNodes = snapshot.taskNodes.filter((node) => node.roomId === roomId);
  const taskNodeIds = new Set(taskNodes.map((node) => node.id));
  const runs = snapshot.runs.filter(
    (run) => run.roomId === roomId || taskIds.has(run.taskId),
  );
  const activeRunCount = runs.filter((run) =>
    ["admitted", "queued", "running", "waiting", "paused", "stalled"].includes(run.status),
  ).length;
  const policyId = runs.find((run) => run.policyId)?.policyId;
  const policy =
    snapshot.runPolicies.find((candidate) => candidate.id === policyId) ??
    snapshot.runPolicies[0] ??
    null;
  const workspace = snapshot.contextWorkspaces.find((candidate) => candidate.roomId === roomId) ?? null;
  const contextRecordCount = workspace
    ? snapshot.contextRecords.filter((record) => record.workspaceId === workspace.id).length
    : 0;
  const specialists = snapshot.specialists
    .filter((specialist) =>
      specialist.allowedScopes.some((scope) =>
        scopeAppliesToRoom(scope, roomId, room.projectId, taskIds, taskNodeIds),
      ),
    )
    .slice(0, 4);

  const nodes: TopologyNode[] = [
    {
      id: "supervised-runtime",
      kind: "runtime",
      eyebrow: "Control plane",
      title: "Supervised runtime",
      detail: `daemon epoch ${snapshot.health.daemonEpoch}`,
      status: snapshot.health.status,
    },
    ...(policy
      ? [
          {
            id: `policy-${policy.id}`,
            kind: "policy" as const,
            eyebrow: "RunPolicy",
            title: policy.name,
            detail: `${policy.maxFanOut} fan-out · ${policy.maxRecursiveCalls} recursive calls`,
            status: "active",
          },
        ]
      : []),
    {
      id: room.leadSeatId ?? "unassigned-lead",
      kind: "lead",
      eyebrow: "Lead",
      title: room.leadSeatId ? String(room.leadSeatId) : "Unassigned Lead",
      detail: `${tasks.length} tasks · ${activeRunCount} active runs`,
      status: room.status,
    },
    ...specialists.map((specialist) => ({
      id: specialist.id,
      kind: "specialist" as const,
      eyebrow: "Specialist",
      title: specialist.concern,
      detail: String(specialist.profilePresetId),
      status: specialist.status,
    })),
    {
      id: workspace?.id ?? "unassigned-workspace",
      kind: "workspace",
      eyebrow: "Durable truth",
      title: "Context workspace",
      detail: workspace ? `${contextRecordCount} retained records` : "Not created yet",
      status: workspace ? `sequence ${workspace.highWaterSequence}` : "pending",
    },
  ];

  return {
    roomTitle: room.title,
    roomStatus: room.status,
    graphRevision: room.graphRevision,
    nodes,
    workspaceId: workspace?.id ?? null,
    taskCount: tasks.length,
    activeRunCount,
    policy,
    contextRecordCount,
    contextSequence: workspace?.highWaterSequence ?? 0,
  };
}

function useRoomTopology(roomId: string) {
  const query = useQuery(supervisedRuntimeQueryOptions());
  const projection = useMemo(
    () => (query.data ? buildRoomTopology(query.data, roomId) : null),
    [query.data, roomId],
  );
  return { ...query, projection };
}

function StatusDot({ status }: { readonly status: string }) {
  const healthy = ["healthy", "active", "retained", "running", "present"].includes(status);
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        healthy ? "bg-emerald-500" : "bg-muted-foreground/55",
      )}
      aria-hidden="true"
    />
  );
}

export function SupervisedTopologySidebar(props: {
  readonly roomId: string;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const query = useRoomTopology(props.roomId);
  const projection = query.projection;
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border/65 bg-[var(--color-background-surface)]">
      <div className="flex h-11 items-center justify-between border-b border-border/55 px-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Room topology
        </span>
        <GitBranchIcon className="size-3.5 text-muted-foreground" />
      </div>
      {!projection ? (
        <div className="px-3 py-5 text-[11px] text-muted-foreground">
          {query.isLoading ? "Loading durable topology…" : "Room topology is unavailable."}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <div className="space-y-0.5">
            {projection.nodes
              .filter((node) => node.kind !== "workspace" && node.kind !== "policy")
              .map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
                    props.selectedNodeId === node.id
                      ? "bg-[var(--color-background-button-secondary-hover)] text-foreground"
                      : "text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
                    node.kind === "specialist" && "pl-7",
                    node.kind === "lead" && "pl-4",
                  )}
                  onClick={() => props.onSelectNode(node.id)}
                >
                  <StatusDot status={node.status} />
                  <span className="min-w-0 flex-1 truncate">{node.title}</span>
                </button>
              ))}
          </div>

          <div className="mt-6 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
            Durable workspace
          </div>
          {projection.nodes
            .filter((node) => node.kind === "workspace")
            .map((node) => (
              <button
                key={node.id}
                type="button"
                className={cn(
                  "mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
                  props.selectedNodeId === node.id
                    ? "bg-[var(--color-background-button-secondary-hover)] text-foreground"
                    : "text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
                )}
                onClick={() => props.onSelectNode(node.id)}
              >
                <StatusDot status={node.status} />
                <span className="truncate">{node.title}</span>
              </button>
            ))}

          <div className="mt-6 px-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
            RunPolicy
          </div>
          <div className="mt-2 rounded-lg border border-border/60 px-3 py-2.5 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between gap-3 text-foreground">
              <span className="truncate font-medium">{projection.policy?.name ?? "No effective policy"}</span>
              <StatusDot status={projection.policy ? "active" : "pending"} />
            </div>
            <dl className="mt-2 space-y-1.5">
              <div className="flex justify-between gap-2">
                <dt>Wall time</dt>
                <dd>{projection.policy ? `${Math.round(projection.policy.maxWallTimeMs / 60_000)} min` : "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Fan-out</dt>
                <dd>{projection.policy?.maxFanOut ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Recursive calls</dt>
                <dd>{projection.policy?.maxRecursiveCalls ?? "—"}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </aside>
  );
}

function mermaidLabel(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("[", "&#91;")
    .replaceAll("]", "&#93;")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function diagramNodeLabel(node: TopologyNode): string {
  return [node.eyebrow.toUpperCase(), node.title, `${node.status} · ${node.detail}`]
    .map(mermaidLabel)
    .join("<br/>");
}

function buildMermaidDefinition(
  projection: RoomTopologyProjection,
  selectedNodeId: string | null,
  dark: boolean,
): { readonly definition: string; readonly diagramNodeIds: ReadonlyMap<string, string> } {
  const runtime = projection.nodes.find((node) => node.kind === "runtime");
  const policy = projection.nodes.find((node) => node.kind === "policy");
  const lead = projection.nodes.find((node) => node.kind === "lead");
  const workspace = projection.nodes.find((node) => node.kind === "workspace");
  const specialists = projection.nodes.filter((node) => node.kind === "specialist");
  const diagramNodeIds = new Map<string, string>();
  const lines = ["flowchart LR"];

  if (runtime) {
    lines.push(`runtime["${diagramNodeLabel(runtime)}"]`);
    diagramNodeIds.set("runtime", runtime.id);
  }
  if (policy) {
    lines.push(`policy["${diagramNodeLabel(policy)}"]`);
    diagramNodeIds.set("policy", policy.id);
  }
  if (lead) {
    lines.push(`lead["${diagramNodeLabel(lead)}"]`);
    diagramNodeIds.set("lead", lead.id);
  }
  specialists.forEach((specialist, index) => {
    const id = `specialist_${index}`;
    lines.push(`${id}["${diagramNodeLabel(specialist)}"]`);
    diagramNodeIds.set(id, specialist.id);
  });
  if (workspace) {
    lines.push(`workspace["${diagramNodeLabel(workspace)}"]`);
    diagramNodeIds.set("workspace", workspace.id);
  }

  if (runtime && lead) lines.push("runtime -->|governs| lead");
  if (policy && lead) lines.push("policy -->|bounds| lead");
  if (lead && specialists.length > 0) {
    specialists.forEach((_, index) => lines.push(`lead -->|delegates| specialist_${index}`));
  }
  if (workspace && specialists.length > 0) {
    specialists.forEach((_, index) =>
      lines.push(`specialist_${index} -.->|checkpoints| workspace`),
    );
  } else if (lead && workspace) {
    lines.push("lead -.->|checkpoints| workspace");
  }

  const surface = dark ? "#171717" : "#ffffff";
  const subtleSurface = dark ? "#141414" : "#fafafa";
  const text = dark ? "#f4f4f5" : "#18181b";
  const border = dark ? "#71717a" : "#71717a";
  const quietBorder = dark ? "#52525b" : "#a1a1aa";
  const accent = dark ? "#818cf8" : "#2563eb";
  lines.push(`classDef runtime fill:${surface},stroke:${border},stroke-width:1.5px,color:${text}`);
  lines.push(`classDef policy fill:${subtleSurface},stroke:${quietBorder},stroke-width:1.25px,color:${text}`);
  lines.push(`classDef lead fill:${surface},stroke:${border},stroke-width:1.5px,color:${text}`);
  lines.push(`classDef specialist fill:${surface},stroke:${quietBorder},stroke-width:1.25px,color:${text}`);
  lines.push(`classDef workspace fill:${subtleSurface},stroke:${quietBorder},stroke-width:1.25px,color:${text}`);
  lines.push(`classDef selected stroke:${accent},stroke-width:3px`);
  if (runtime) lines.push("class runtime runtime");
  if (policy) lines.push("class policy policy");
  if (lead) lines.push("class lead lead");
  if (workspace) lines.push("class workspace workspace");
  if (specialists.length > 0) {
    lines.push(`class ${specialists.map((_, index) => `specialist_${index}`).join(",")} specialist`);
  }
  for (const [diagramId, nodeId] of diagramNodeIds) {
    if (nodeId === selectedNodeId) lines.push(`class ${diagramId} selected`);
  }
  return { definition: lines.join("\n"), diagramNodeIds };
}

function MermaidTopologyGraph(props: {
  readonly projection: RoomTopologyProjection;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const diagramId = useId().replaceAll(":", "-");
  const [renderError, setRenderError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const { definition, diagramNodeIds } = buildMermaidDefinition(
    props.projection,
    props.selectedNodeId,
    dark,
  );
  const diagramNodeIdsRef = useRef(diagramNodeIds);
  diagramNodeIdsRef.current = diagramNodeIds;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "transparent",
            fontFamily: "inherit",
            fontSize: "13px",
            lineColor: dark ? "#a1a1aa" : "#71717a",
            edgeLabelBackground: dark ? "#0f0f10" : "#ffffff",
            primaryColor: dark ? "#171717" : "#ffffff",
            primaryTextColor: dark ? "#f4f4f5" : "#18181b",
            primaryBorderColor: "#71717a",
          },
          flowchart: {
            curve: "basis",
            htmlLabels: true,
            nodeSpacing: 56,
            rankSpacing: 104,
            padding: 18,
          },
        });
        const rendered = await mermaid.render(`supervised-topology-${diagramId}`, definition);
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = rendered.svg;
        hostRef.current.querySelectorAll<SVGGElement>("g.node").forEach((node) => {
          const diagramNodeId = [...diagramNodeIdsRef.current.keys()].find(
            (candidate) =>
              node.dataset.id === candidate ||
              node.id === candidate ||
              node.id.startsWith(`flowchart-${candidate}-`) ||
              node.id.includes(`-${candidate}-`) ||
              node.id.endsWith(`-${candidate}`),
          );
          const runtimeNodeId = diagramNodeId
            ? diagramNodeIdsRef.current.get(diagramNodeId)
            : undefined;
          if (!runtimeNodeId) return;
          node.querySelector("rect")?.setAttribute("rx", "8");
          node.querySelector("rect")?.setAttribute("ry", "8");
          node.style.cursor = "pointer";
          node.setAttribute("role", "button");
          node.setAttribute("tabindex", "0");
          node.setAttribute("aria-label", `Select ${runtimeNodeId}`);
          const select = () => props.onSelectNode(runtimeNodeId);
          node.addEventListener("click", select);
          node.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") select();
          });
        });
        setRenderError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRenderError(error instanceof Error ? error.message : "Unable to render topology.");
      });

    return () => {
      cancelled = true;
    };
  }, [dark, definition, diagramId, props.onSelectNode]);

  if (renderError) {
    return (
      <div className="flex min-h-64 items-center justify-center text-xs text-destructive">
        {renderError}
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="mx-auto flex min-h-[440px] w-full min-w-0 items-center justify-center px-6 py-8 [&_svg]:h-auto [&_svg]:max-h-[460px] [&_svg]:w-full [&_.edgeLabel]:text-[11px] [&_.label]:leading-5 [&_.node]:drop-shadow-sm"
      aria-label="Room governance topology"
    />
  );
}

export function SupervisedTopologyCanvas(props: {
  readonly roomId: string;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string) => void;
}) {
  const query = useRoomTopology(props.roomId);
  const projection = query.projection;
  const [zoom, setZoom] = useState(1);
  const selectedNode = projection?.nodes.find((node) => node.id === props.selectedNodeId) ?? null;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-background-root)]">
      <div className="flex h-10 shrink-0 items-end border-b border-border/60">
        <div className="flex h-full items-center gap-2 border-r border-border/60 px-3 text-[11px] text-foreground">
          <span className="size-1.5 rounded-full bg-[var(--color-text-accent)]" />
          governance.graph
        </div>
      </div>
      <div className="flex h-8 shrink-0 items-center border-b border-border/45 px-3 text-[10px] text-muted-foreground">
        {projection ? (
          <>
            <span className="truncate">{projection.roomTitle}</span>
            <span className="px-1.5 text-muted-foreground/35">›</span>
            <span>live topology</span>
          </>
        ) : (
          <span>Loading durable topology…</span>
        )}
      </div>
      <div
        className="relative min-h-0 flex-1 overflow-auto"
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in srgb, var(--color-border) 60%, transparent) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      >
        {!projection ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {query.isLoading ? "Projecting Room topology…" : "Room topology is unavailable."}
          </div>
        ) : (
          <div
            className="mx-auto w-full min-w-0 max-w-[1080px] origin-center transition-transform duration-150"
            style={{ transform: `scale(${zoom})` }}
          >
            <MermaidTopologyGraph
              projection={projection}
              selectedNodeId={props.selectedNodeId}
              onSelectNode={props.onSelectNode}
            />
          </div>
        )}

        {projection ? (
          <div className="pointer-events-none sticky bottom-0 flex items-end justify-between gap-4 p-3">
            <div className="pointer-events-auto rounded-md border border-border/65 bg-[var(--color-background-surface)] px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm">
              <span className="text-[var(--color-text-accent)]">●</span> Live topology · revision {projection.graphRevision}
              {selectedNode ? <span> · selected {selectedNode.title}</span> : null}
            </div>
            <div className="pointer-events-auto flex items-center rounded-md border border-border/65 bg-[var(--color-background-surface)] shadow-sm">
              <button
                type="button"
                aria-label="Zoom out topology"
                className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-35"
                disabled={zoom <= 0.8}
                onClick={() => setZoom((value) => Math.max(0.8, Number((value - 0.1).toFixed(1))))}
              >
                <MinusIcon className="size-3.5" />
              </button>
              <span className="w-10 text-center text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="Zoom in topology"
                className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-35"
                disabled={zoom >= 1.2}
                onClick={() => setZoom((value) => Math.min(1.2, Number((value + 0.1).toFixed(1))))}
              >
                <PlusIcon className="size-3.5" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {projection ? (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-border/55 px-3 text-[10px] text-muted-foreground">
          <span>{projection.taskCount} tasks · {projection.activeRunCount} active runs</span>
          <span>{projection.contextRecordCount} context records · sequence {projection.contextSequence}</span>
          <span className="flex items-center gap-1.5"><StatusDot status={query.data?.health.status ?? "stopped"} /> runtime {query.data?.health.status}</span>
        </div>
      ) : null}
    </section>
  );
}
