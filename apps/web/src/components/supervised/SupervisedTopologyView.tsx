import type { AuthorityScope, SupervisedRuntimeSnapshot } from "@synara/contracts";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type CSSProperties,
  type MouseEvent,
} from "react";

import { useTheme } from "~/hooks/useTheme";
import { supervisedRuntimeQueryOptions } from "~/lib/supervisedRuntime";
import { cn } from "~/lib/utils";
import { GitBranchIcon } from "~/lib/icons";

import "@xyflow/react/dist/style.css";

type TopologyNodeKind = "runtime" | "policy" | "lead" | "specialist" | "workspace";

interface TopologyNode {
  readonly id: string;
  readonly kind: TopologyNodeKind;
  readonly eyebrow: string;
  /** Short label shown on the card (demo-style, never a raw 36-char UUID). */
  readonly title: string;
  /** Full identity for tooltip / a11y when title is truncated. */
  readonly fullTitle?: string;
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

type TopologyFlowNodeData = {
  id: string;
  kind: TopologyNodeKind;
  eyebrow: string;
  title: string;
  fullTitle?: string;
  detail: string;
  status: string;
  selected: boolean;
};

type TopologyFlowNode = Node<TopologyFlowNodeData, "topology">;

const NODE_HEIGHT = 92;
const ROW_GAP = 24;
const NODE_WIDTH = 220;
const COL_GAP = 80;

/** Demo-like short seat labels: `seat:lead-opus`, never full UUID. */
function formatTopologySeatLabel(raw: string | null | undefined): {
  readonly title: string;
  readonly fullTitle: string;
} {
  if (raw == null || raw.trim().length === 0) {
    return { title: "Unassigned Lead", fullTitle: "Unassigned Lead" };
  }
  const full = String(raw).trim();
  // Already human-ish: seat:lead-opus / lead-opus
  if (/^seat:/i.test(full) || /^lead[-_]/i.test(full)) {
    const short = full.length > 24 ? `${full.slice(0, 22)}…` : full;
    return { title: short, fullTitle: full };
  }
  // UUID or uuid-like
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(full)) {
    return { title: `lead · ${full.slice(0, 8)}`, fullTitle: full };
  }
  if (full.length > 22) {
    return { title: `${full.slice(0, 20)}…`, fullTitle: full };
  }
  return { title: full, fullTitle: full };
}

function formatTopologyTitle(raw: string, max = 22): {
  readonly title: string;
  readonly fullTitle: string;
} {
  const full = raw.trim();
  if (full.length <= max) return { title: full, fullTitle: full };
  return { title: `${full.slice(0, max - 1)}…`, fullTitle: full };
}

/** Sparse (no specialists): tight 3-column LR. Dense: room for peer column. */
function columnX(specialistCount: number): {
  readonly runtime: number;
  readonly policy: number;
  readonly lead: number;
  readonly specialist: number;
  readonly workspace: number;
} {
  if (specialistCount === 0) {
    return {
      runtime: 0,
      policy: 0,
      lead: NODE_WIDTH + COL_GAP,
      specialist: NODE_WIDTH + COL_GAP,
      workspace: (NODE_WIDTH + COL_GAP) * 2,
    };
  }
  return {
    runtime: 0,
    policy: 0,
    lead: NODE_WIDTH + COL_GAP,
    specialist: (NODE_WIDTH + COL_GAP) * 2,
    workspace: (NODE_WIDTH + COL_GAP) * 3,
  };
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
    ? (snapshot.contextRecords ?? []).filter((record) => record.workspaceId === workspace.id)
        .length
    : 0;
  const specialists = (snapshot.specialists ?? [])
    .filter((specialist) =>
      specialist.allowedScopes.some((scope) =>
        scopeAppliesToRoom(scope, roomId, room.projectId, taskIds, taskNodeIds),
      ),
    )
    .slice(0, 4);

  const leadLabel = formatTopologySeatLabel(room.leadSeatId);
  const policyLabel = policy ? formatTopologyTitle(policy.name, 24) : null;

  const nodes: TopologyNode[] = [
    {
      id: "supervised-runtime",
      kind: "runtime",
      eyebrow: "Control plane",
      title: "Supervised runtime",
      detail: `daemon epoch ${snapshot.health.daemonEpoch}`,
      status: snapshot.health.status,
    },
    ...(policy && policyLabel
      ? [
          {
            id: `policy-${policy.id}`,
            kind: "policy" as const,
            eyebrow: "RunPolicy",
            title: policyLabel.title,
            fullTitle: policyLabel.fullTitle,
            detail: `${policy.maxFanOut} fan-out · ${policy.maxRecursiveCalls} recursive calls`,
            status: "active",
          },
        ]
      : []),
    {
      id: room.leadSeatId ?? "unassigned-lead",
      kind: "lead",
      eyebrow: "Lead",
      title: leadLabel.title,
      fullTitle: leadLabel.fullTitle,
      detail: `${tasks.length} tasks · ${activeRunCount} active runs`,
      status: room.status,
    },
    ...specialists.map((specialist) => {
      const concern = formatTopologyTitle(specialist.concern, 22);
      return {
        id: specialist.id,
        kind: "specialist" as const,
        eyebrow: "Specialist",
        title: concern.title,
        fullTitle: concern.fullTitle,
        detail: String(specialist.profilePresetId),
        status: specialist.status,
      };
    }),
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

function isHealthyStatus(status: string): boolean {
  return ["healthy", "active", "retained", "running", "present"].includes(status);
}

function StatusDot({ status }: { readonly status: string }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        isHealthyStatus(status) ? "bg-emerald-500" : "bg-muted-foreground/55",
      )}
      aria-hidden="true"
    />
  );
}

export function SupervisedTopologySidebar(props: {
  readonly roomId: string;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string | null) => void;
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

type TopologyPalette = {
  readonly canvas: string;
  readonly nodeBg: string;
  readonly nodeBgSubtle: string;
  readonly nodeBorder: string;
  readonly nodeBorderQuiet: string;
  readonly text: string;
  readonly muted: string;
  readonly muted2: string;
  readonly accent: string;
  readonly edge: string;
  readonly edgeQuiet: string;
  readonly labelBg: string;
  readonly labelText: string;
  readonly labelBorder: string;
  readonly handleBorder: string;
  readonly handleBg: string;
  readonly controlBg: string;
  readonly controlBorder: string;
  readonly controlText: string;
  readonly controlHover: string;
  readonly minimapNode: string;
  readonly minimapSelected: string;
  readonly mask: string;
  readonly dots: string;
  readonly shadow: string;
  readonly selectedShadow: string;
  readonly liveShadow: string;
};

const TOPO_DARK: TopologyPalette = {
  canvas: "#0c0c0d",
  nodeBg: "#17171a",
  nodeBgSubtle: "#141416",
  nodeBorder: "#71717a",
  nodeBorderQuiet: "#52525b",
  text: "#f4f4f5",
  muted: "#a1a1aa",
  muted2: "#71717a",
  accent: "#818cf8",
  edge: "#71717a",
  edgeQuiet: "#52525b",
  labelBg: "#0c0c0d",
  labelText: "#a1a1aa",
  labelBorder: "#3f3f46",
  handleBorder: "#a1a1aa",
  handleBg: "#0c0c0d",
  controlBg: "#121214",
  controlBorder: "#3f3f46",
  controlText: "#a1a1aa",
  controlHover: "#1e1e22",
  minimapNode: "#27272a",
  minimapSelected: "#312e81",
  mask: "rgba(12,12,13,0.55)",
  dots: "rgba(255,255,255,0.08)",
  shadow: "0 10px 28px rgba(0,0,0,0.28)",
  selectedShadow: "0 0 0 1px rgba(129,140,248,0.55), 0 12px 30px rgba(0,0,0,0.35)",
  liveShadow: "0 0 0 1px rgba(52,211,153,0.22), 0 10px 28px rgba(0,0,0,0.28)",
};

const TOPO_LIGHT: TopologyPalette = {
  canvas: "#fafafa",
  nodeBg: "#ffffff",
  nodeBgSubtle: "#f4f4f5",
  nodeBorder: "#a1a1aa",
  nodeBorderQuiet: "#d4d4d8",
  text: "#18181b",
  muted: "#71717a",
  muted2: "#a1a1aa",
  accent: "#2563eb",
  edge: "#a1a1aa",
  edgeQuiet: "#d4d4d8",
  labelBg: "#ffffff",
  labelText: "#52525b",
  labelBorder: "#e4e4e7",
  handleBorder: "#a1a1aa",
  handleBg: "#ffffff",
  controlBg: "#ffffff",
  controlBorder: "#e4e4e7",
  controlText: "#71717a",
  controlHover: "#f4f4f5",
  minimapNode: "#e4e4e7",
  minimapSelected: "#bfdbfe",
  mask: "rgba(250,250,250,0.55)",
  dots: "rgba(0,0,0,0.08)",
  shadow: "0 8px 20px rgba(0,0,0,0.08)",
  selectedShadow: "0 0 0 1px rgba(37,99,235,0.45), 0 10px 24px rgba(0,0,0,0.10)",
  liveShadow: "0 0 0 1px rgba(16,185,129,0.28), 0 8px 20px rgba(0,0,0,0.08)",
};

const TopologyPaletteContext = createContext<TopologyPalette>(TOPO_DARK);

function useTopologyPalette(): TopologyPalette {
  return useContext(TopologyPaletteContext);
}

const TopologyFlowNodeView = memo(function TopologyFlowNodeView(
  props: NodeProps<TopologyFlowNode>,
) {
  const topo = useTopologyPalette();
  const { data, selected } = props;
  const live = data.status === "running" || data.status === "healthy";
  const subtle = data.kind === "policy" || data.kind === "workspace";
  return (
    <div
      className="w-[220px] overflow-hidden rounded-[10px] border-[1.5px] transition-[border-color,box-shadow]"
      style={{
        background: subtle ? topo.nodeBgSubtle : topo.nodeBg,
        borderColor: selected ? topo.accent : subtle ? topo.nodeBorderQuiet : topo.nodeBorder,
        color: topo.text,
        boxShadow: selected ? topo.selectedShadow : live ? topo.liveShadow : topo.shadow,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2 !border-[1.5px]"
        style={{ borderColor: topo.handleBorder, background: topo.handleBg }}
      />
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: topo.muted2 }}
        >
          {data.eyebrow}
        </span>
        <StatusDot status={data.status} />
      </div>
      <div
        className="truncate px-3 pt-1 text-[13px] font-semibold leading-snug"
        style={{ color: topo.text }}
        title={data.fullTitle ?? data.title}
      >
        {data.title}
      </div>
      <div className="px-3 pt-1.5 pb-3 text-[11px] leading-snug" style={{ color: topo.muted }}>
        {data.status} · {data.detail}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2 !border-[1.5px]"
        style={{ borderColor: topo.handleBorder, background: topo.handleBg }}
      />
    </div>
  );
});

const topologyNodeTypes = {
  topology: TopologyFlowNodeView,
};

type TopologyEdgeData = {
  readonly labelOffsetX?: number;
  readonly labelOffsetY?: number;
};

/** HTML labels with path-offset so stroke never covers the chip. */
const TopologyLabeledEdge = memo(function TopologyLabeledEdge(
  props: EdgeProps<Edge<TopologyEdgeData>>,
) {
  const topo = useTopologyPalette();
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    label,
    style,
    markerEnd,
    data,
  } = props;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const labelText = typeof label === "string" || typeof label === "number" ? String(label) : null;

  // Pull the chip off the stroke: vertical-ish edges shift sideways, horizontal-ish shift up.
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const mostlyVertical = Math.abs(dy) > Math.abs(dx) * 0.55;
  const autoOffsetX = mostlyVertical ? (dx >= 0 ? 14 : -14) : 0;
  const autoOffsetY = mostlyVertical ? 0 : -12;
  const offsetX = data?.labelOffsetX ?? autoOffsetX;
  const offsetY = data?.labelOffsetY ?? autoOffsetY;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        {...(style !== undefined ? { style } : {})}
        {...(markerEnd !== undefined ? { markerEnd } : {})}
      />
      {labelText ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute z-10 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none shadow-sm"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX + offsetX}px, ${labelY + offsetY}px)`,
              background: topo.labelBg,
              color: topo.labelText,
              border: `1px solid ${topo.labelBorder}`,
            }}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});

const topologyEdgeTypes = {
  topology: TopologyLabeledEdge,
};

function buildTopologyFlowGraph(
  projection: RoomTopologyProjection,
  selectedNodeId: string | null,
  palette: TopologyPalette,
): { readonly nodes: TopologyFlowNode[]; readonly edges: Edge[] } {
  const runtime = projection.nodes.find((node) => node.kind === "runtime");
  const policy = projection.nodes.find((node) => node.kind === "policy");
  const lead = projection.nodes.find((node) => node.kind === "lead");
  const workspace = projection.nodes.find((node) => node.kind === "workspace");
  const specialists = projection.nodes.filter((node) => node.kind === "specialist");
  const col = columnX(specialists.length);

  const specialistStackHeight =
    specialists.length === 0
      ? NODE_HEIGHT
      : specialists.length * NODE_HEIGHT + (specialists.length - 1) * ROW_GAP;
  const stackMid = specialistStackHeight / 2;

  const nodes: TopologyFlowNode[] = [];

  if (runtime) {
    nodes.push({
      id: runtime.id,
      type: "topology",
      position: { x: col.runtime, y: Math.max(0, stackMid - NODE_HEIGHT - 16) },
      data: { ...runtime, selected: selectedNodeId === runtime.id },
      selected: selectedNodeId === runtime.id,
      draggable: false,
    });
  }
  if (policy) {
    nodes.push({
      id: policy.id,
      type: "topology",
      position: { x: col.policy, y: Math.max(NODE_HEIGHT + 28, stackMid + 16) },
      data: { ...policy, selected: selectedNodeId === policy.id },
      selected: selectedNodeId === policy.id,
      draggable: false,
    });
  }
  if (lead) {
    nodes.push({
      id: lead.id,
      type: "topology",
      position: { x: col.lead, y: Math.max(0, stackMid - NODE_HEIGHT / 2) },
      data: { ...lead, selected: selectedNodeId === lead.id },
      selected: selectedNodeId === lead.id,
      draggable: false,
    });
  }

  specialists.forEach((specialist, index) => {
    nodes.push({
      id: specialist.id,
      type: "topology",
      position: { x: col.specialist, y: index * (NODE_HEIGHT + ROW_GAP) },
      data: { ...specialist, selected: selectedNodeId === specialist.id },
      selected: selectedNodeId === specialist.id,
      draggable: false,
    });
  });

  if (workspace) {
    nodes.push({
      id: workspace.id,
      type: "topology",
      position: { x: col.workspace, y: Math.max(0, stackMid - NODE_HEIGHT / 2) },
      data: { ...workspace, selected: selectedNodeId === workspace.id },
      selected: selectedNodeId === workspace.id,
      draggable: false,
    });
  }

  const baseEdge = {
    type: "topology" as const,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 14,
      height: 14,
      color: palette.edge,
    },
    style: { stroke: palette.edge, strokeWidth: 1.25 },
  };

  const edges: Edge<TopologyEdgeData>[] = [];
  if (runtime && lead) {
    edges.push({
      ...baseEdge,
      id: `e-${runtime.id}-${lead.id}`,
      source: runtime.id,
      target: lead.id,
      label: "governs",
      data: { labelOffsetX: 0, labelOffsetY: -14 },
    });
  }
  if (policy && lead) {
    edges.push({
      ...baseEdge,
      id: `e-${policy.id}-${lead.id}`,
      source: policy.id,
      target: lead.id,
      label: "bounds",
      // Policy sits below runtime → lead: shift chip off the vertical join.
      data: { labelOffsetX: 16, labelOffsetY: 0 },
    });
  }
  for (const specialist of specialists) {
    if (lead) {
      edges.push({
        ...baseEdge,
        id: `e-${lead.id}-${specialist.id}`,
        source: lead.id,
        target: specialist.id,
        label: "delegates",
        animated: specialist.status === "running",
        data: { labelOffsetX: 0, labelOffsetY: -12 },
      });
    }
    if (workspace) {
      edges.push({
        ...baseEdge,
        id: `e-${specialist.id}-${workspace.id}`,
        source: specialist.id,
        target: workspace.id,
        label: "checkpoints",
        style: { stroke: palette.edgeQuiet, strokeWidth: 1.25, strokeDasharray: "5 4" },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: palette.edgeQuiet,
        },
        data: { labelOffsetX: 0, labelOffsetY: -12 },
      });
    }
  }
  if (lead && workspace && specialists.length === 0) {
    edges.push({
      ...baseEdge,
      id: `e-${lead.id}-${workspace.id}`,
      source: lead.id,
      target: workspace.id,
      label: "checkpoints",
      style: { stroke: palette.edgeQuiet, strokeWidth: 1.25, strokeDasharray: "5 4" },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 14,
        height: 14,
        color: palette.edgeQuiet,
      },
      data: { labelOffsetX: 0, labelOffsetY: -12 },
    });
  }

  return { nodes, edges };
}

/** Sparse room graphs (runtime/policy/lead/workspace ± few specialists) should not zoom out to postage-stamp size. */
const SPARSE_NODE_COUNT = 6;
const FIT_MIN_ZOOM_SPARSE = 0.9;
const FIT_MIN_ZOOM_DENSE = 0.45;
const FIT_MAX_ZOOM = 1.25;
const FIT_PADDING = 0.12;

function FitViewOnProjection(props: {
  readonly revision: number;
  readonly nodeCount: number;
}) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const sparse = props.nodeCount <= SPARSE_NODE_COUNT;
    const timer = window.setTimeout(() => {
      void fitView({
        padding: FIT_PADDING,
        minZoom: sparse ? FIT_MIN_ZOOM_SPARSE : FIT_MIN_ZOOM_DENSE,
        maxZoom: FIT_MAX_ZOOM,
        duration: 220,
      });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [fitView, props.revision, props.nodeCount]);
  return null;
}

function TopologyReactFlowGraph(props: {
  readonly projection: RoomTopologyProjection;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string | null) => void;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const palette = dark ? TOPO_DARK : TOPO_LIGHT;

  const graph = useMemo(
    () => buildTopologyFlowGraph(props.projection, props.selectedNodeId, palette),
    [props.projection, props.selectedNodeId, palette],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<TopologyFlowNode>(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  const onSelectNode = props.onSelectNode;
  const onNodeClick = useCallback(
    (_event: MouseEvent, node: TopologyFlowNode) => {
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  const onPaneClick = useCallback(() => {
    onSelectNode(null);
  }, [onSelectNode]);

  return (
    <TopologyPaletteContext.Provider value={palette}>
      <div
        className="h-full min-h-0 w-full min-w-0"
        aria-label="Room governance topology"
        style={{ background: palette.canvas }}
      >
        <ReactFlow<TopologyFlowNode>
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={topologyNodeTypes}
          fitView
          fitViewOptions={{
            padding: FIT_PADDING,
            minZoom: FIT_MIN_ZOOM_SPARSE,
            maxZoom: FIT_MAX_ZOOM,
          }}
          minZoom={0.35}
          maxZoom={1.75}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnScroll
          zoomOnScroll
          colorMode={dark ? "dark" : "light"}
          proOptions={{ hideAttribution: false }}
          edgeTypes={topologyEdgeTypes}
          defaultEdgeOptions={{ type: "topology" }}
          className="supervised-topology-flow"
          style={
            {
              background: palette.canvas,
              ["--xy-controls-button-background-color"]: palette.controlBg,
              ["--xy-controls-button-background-color-hover"]: palette.controlHover,
              ["--xy-controls-button-color"]: palette.controlText,
              ["--xy-controls-button-color-hover"]: palette.text,
              ["--xy-controls-button-border-color"]: palette.controlBorder,
            } as CSSProperties
          }
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color={palette.dots}
          />
          <Controls
            showInteractive={false}
            position="bottom-right"
            className="!overflow-hidden !rounded-md !border !shadow-sm"
            style={{ borderColor: palette.controlBorder, background: palette.controlBg }}
          />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            className="!overflow-hidden !rounded-md !border !shadow-sm"
            style={{ borderColor: palette.controlBorder, background: palette.controlBg }}
            nodeStrokeColor={(node) => (node.selected ? palette.accent : palette.nodeBorderQuiet)}
            nodeColor={(node) => (node.selected ? palette.minimapSelected : palette.minimapNode)}
            maskColor={palette.mask}
          />
          <FitViewOnProjection
            revision={props.projection.graphRevision}
            nodeCount={graph.nodes.length}
          />
        </ReactFlow>
      </div>
    </TopologyPaletteContext.Provider>
  );
}

export function SupervisedTopologyCanvas(props: {
  readonly roomId: string;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string | null) => void;
}) {
  const query = useRoomTopology(props.roomId);
  const projection = query.projection;
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!projection ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {query.isLoading ? "Projecting Room topology…" : "Room topology is unavailable."}
          </div>
        ) : (
          <ReactFlowProvider>
            <TopologyReactFlowGraph
              projection={projection}
              selectedNodeId={props.selectedNodeId}
              onSelectNode={props.onSelectNode}
            />
          </ReactFlowProvider>
        )}

        {projection ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-center p-3">
            <div className="pointer-events-auto rounded-md border border-border/65 bg-[var(--color-background-surface)]/95 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
              <span className="text-[var(--color-text-accent)]">●</span> Live topology · revision{" "}
              {projection.graphRevision}
              {selectedNode ? <span> · selected {selectedNode.title}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
      {projection ? (
        <div className="flex h-8 shrink-0 items-center justify-between border-t border-border/55 px-3 text-[10px] text-muted-foreground">
          <span>
            {projection.taskCount} tasks · {projection.activeRunCount} active runs
          </span>
          <span>
            {projection.contextRecordCount} context records · sequence {projection.contextSequence}
          </span>
          <span className="flex items-center gap-1.5">
            <StatusDot status={query.data?.health.status ?? "stopped"} /> runtime{" "}
            {query.data?.health.status}
          </span>
        </div>
      ) : null}
    </section>
  );
}
