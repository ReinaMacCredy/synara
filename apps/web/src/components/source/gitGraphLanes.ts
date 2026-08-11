// VS Code–style git graph: active-column layout + per-row edge list.
// Commits are newest-first (git log / topo order). Each open column holds the
// next older SHA that line is waiting to meet.

export interface GraphCommitInput {
  readonly sha: string;
  readonly parents: readonly string[];
}

/** One stroked segment inside a row (y: 0 = top, 0.5 = mid, 1 = bottom). */
export interface GraphEdge {
  readonly fromLane: number;
  readonly toLane: number;
  readonly fromY: 0 | 0.5 | 1;
  readonly toY: 0 | 0.5 | 1;
  /** Lane index used for color (usually the branch that owns the stroke). */
  readonly colorLane: number;
}

export interface GraphLaneRow {
  readonly sha: string;
  readonly lane: number;
  readonly isMerge: boolean;
  readonly edges: readonly GraphEdge[];
}

export const GIT_GRAPH_LANE_COLORS = [
  "#39c5cf",
  "#ba68c8",
  "#8bc34a",
  "#ff9800",
  "#f44336",
  "#26c6da",
  "#7e57c2",
  "#66bb6a",
  "#42a5f5",
  "#ec407a",
] as const;

export function gitGraphLaneColor(lane: number): string {
  return GIT_GRAPH_LANE_COLORS[lane % GIT_GRAPH_LANE_COLORS.length]!;
}

function firstEmpty(open: readonly (string | null)[]): number {
  const free = open.findIndex((entry) => entry === null);
  return free === -1 ? open.length : free;
}

/**
 * Assign lanes and draw edges for a newest-first commit list.
 */
export function assignGitGraphLanes(commits: readonly GraphCommitInput[]): GraphLaneRow[] {
  // open[i] = SHA this column will meet next (going older). null = free.
  const open: Array<string | null> = [];
  const rows: GraphLaneRow[] = [];

  for (const commit of commits) {
    const edges: GraphEdge[] = [];

    // Columns already reserved for this commit by newer children.
    const reserved: number[] = [];
    for (let i = 0; i < open.length; i += 1) {
      if (open[i] === commit.sha) reserved.push(i);
    }

    const isNewTip = reserved.length === 0;
    let nodeLane: number;
    if (isNewTip) {
      nodeLane = firstEmpty(open);
      if (nodeLane === open.length) open.push(null);
    } else {
      nodeLane = reserved[0]!;
    }

    // Snapshot which columns are live entering this row (before we rewrite open).
    const before = open.slice();

    // Top → node: reserved columns feed into the commit (or straight down onto it).
    for (const lane of reserved) {
      if (lane === nodeLane) {
        edges.push({
          fromLane: lane,
          toLane: lane,
          fromY: 0,
          toY: 0.5,
          colorLane: lane,
        });
      } else {
        edges.push({
          fromLane: lane,
          toLane: nodeLane,
          fromY: 0,
          toY: 0.5,
          colorLane: lane,
        });
      }
    }

    // Pass-through: live columns that are NOT this commit stay active for the full row
    // (we'll confirm after parent placement that they still hold the same tip).
    const passThrough: number[] = [];
    for (let i = 0; i < before.length; i += 1) {
      if (before[i] !== null && before[i] !== commit.sha) passThrough.push(i);
    }

    // Consume every reservation for this commit.
    for (const lane of reserved) open[lane] = null;

    // Place parents: first parent continues on nodeLane; others open/join lanes.
    const forkLanes: number[] = [];
    const parents = commit.parents;
    if (parents.length > 0) {
      open[nodeLane] = parents[0]!;
      for (let p = 1; p < parents.length; p += 1) {
        const parent = parents[p]!;
        let parentLane = open.findIndex((entry) => entry === parent);
        if (parentLane === -1) {
          parentLane = firstEmpty(open);
          if (parentLane === open.length) open.push(parent);
          else open[parentLane] = parent;
        }
        if (parentLane !== nodeLane) forkLanes.push(parentLane);
      }
    }

    // Pass-through verticals (unchanged tips).
    for (const lane of passThrough) {
      if (open[lane] !== null && open[lane] === before[lane]) {
        edges.push({
          fromLane: lane,
          toLane: lane,
          fromY: 0,
          toY: 1,
          colorLane: lane,
        });
      }
    }

    // Node → first parent (down the same lane), if any parent exists.
    if (parents.length > 0) {
      edges.push({
        fromLane: nodeLane,
        toLane: nodeLane,
        fromY: 0.5,
        toY: 1,
        colorLane: nodeLane,
      });
    }

    // Node → secondary parents (fork / merge-from-below in newest-first terms).
    for (const lane of new Set(forkLanes)) {
      edges.push({
        fromLane: nodeLane,
        toLane: lane,
        fromY: 0.5,
        toY: 1,
        colorLane: lane,
      });
    }

    rows.push({
      sha: commit.sha,
      lane: nodeLane,
      isMerge: parents.length > 1,
      edges,
    });
  }

  return rows;
}

export function maxGitGraphLane(rows: readonly GraphLaneRow[]): number {
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, row.lane);
    for (const edge of row.edges) {
      max = Math.max(max, edge.fromLane, edge.toLane, edge.colorLane);
    }
  }
  return max;
}

export function gitGraphSvgWidth(maxLane: number, padX = 11, gap = 15): number {
  return Math.max(28, padX * 2 + maxLane * gap);
}

export function renderGitGraphLaneSvg(input: {
  readonly row: GraphLaneRow;
  readonly maxLane: number;
  readonly rowHeight: number;
  readonly width: number;
  readonly padX?: number;
  readonly gap?: number;
  readonly nodeRadius?: number;
  readonly strokeWidth?: number;
}): string {
  const padX = input.padX ?? 11;
  const gap = input.gap ?? 15;
  const nodeRadius = input.nodeRadius ?? 4;
  const strokeWidth = input.strokeWidth ?? 2.25;
  const h = input.rowHeight;
  const xAt = (lane: number) => padX + lane * gap;
  const yAt = (y: 0 | 0.5 | 1) => (y === 0 ? 0 : y === 1 ? h : h / 2);

  let parts = "";

  for (const edge of input.row.edges) {
    const x0 = xAt(edge.fromLane);
    const x1 = xAt(edge.toLane);
    const y0 = yAt(edge.fromY);
    const y1 = yAt(edge.toY);
    const color = gitGraphLaneColor(edge.colorLane);

    if (edge.fromLane === edge.toLane) {
      parts += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`;
    } else {
      // Smooth orthogonal-ish curve (VS Code Git Graph feel).
      const midY = (y0 + y1) / 2;
      parts += `<path d="M ${x0} ${y0} C ${x0} ${midY}, ${x1} ${midY}, ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }

  const nx = xAt(input.row.lane);
  const ny = h / 2;
  const nc = gitGraphLaneColor(input.row.lane);
  if (input.row.isMerge) {
    parts += `<circle cx="${nx}" cy="${ny}" r="${nodeRadius + 1.2}" fill="#0c0c0d" stroke="${nc}" stroke-width="2"/>`;
    parts += `<circle cx="${nx}" cy="${ny}" r="${nodeRadius - 0.6}" fill="${nc}"/>`;
  } else {
    parts += `<circle cx="${nx}" cy="${ny}" r="${nodeRadius}" fill="${nc}" stroke="#0c0c0d" stroke-width="1"/>`;
  }

  return `<svg viewBox="0 0 ${input.width} ${h}" width="${input.width}" height="${h}" aria-hidden="true">${parts}</svg>`;
}
