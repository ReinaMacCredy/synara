// Pure lane assignment + SVG path geometry for the Source commit graph.
// Walks commits newest-first (git log order). First parent continues the lane;
// additional parents open side lanes when not already assigned.

export interface GraphCommitInput {
  readonly sha: string;
  readonly parents: readonly string[];
}

export interface GraphLaneRow {
  readonly sha: string;
  readonly lane: number;
  readonly parentLanes: readonly number[];
  readonly isMerge: boolean;
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
] as const;

export function assignGitGraphLanes(commits: readonly GraphCommitInput[]): GraphLaneRow[] {
  const laneBySha = new Map<string, number>();
  let nextLane = 0;
  const rows: GraphLaneRow[] = [];

  for (const commit of commits) {
    let lane = laneBySha.get(commit.sha);
    if (lane === undefined) {
      lane = nextLane;
      nextLane += 1;
      laneBySha.set(commit.sha, lane);
    }

    const parentLanes: number[] = [];
    for (let index = 0; index < commit.parents.length; index += 1) {
      const parent = commit.parents[index]!;
      let parentLane = laneBySha.get(parent);
      if (parentLane === undefined) {
        // First parent continues this commit's lane; others open new lanes.
        parentLane = index === 0 ? lane : nextLane++;
        laneBySha.set(parent, parentLane);
      }
      parentLanes.push(parentLane);
    }

    rows.push({
      sha: commit.sha,
      lane,
      parentLanes,
      isMerge: commit.parents.length > 1,
    });
  }

  return rows;
}

export function gitGraphLaneColor(lane: number): string {
  return GIT_GRAPH_LANE_COLORS[lane % GIT_GRAPH_LANE_COLORS.length]!;
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
  const padX = input.padX ?? 10;
  const gap = input.gap ?? 12;
  const nodeRadius = input.nodeRadius ?? 3.6;
  const strokeWidth = input.strokeWidth ?? 1.6;
  const midY = input.rowHeight / 2;
  const xs: number[] = [];
  for (let i = 0; i <= input.maxLane; i += 1) xs.push(padX + i * gap);

  let parts = "";
  for (let i = 0; i <= input.maxLane; i += 1) {
    const x = xs[i]!;
    const color = gitGraphLaneColor(i);
    parts += `<line x1="${x}" y1="0" x2="${x}" y2="${input.rowHeight}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="0.45"/>`;
  }

  // Curves from this commit toward each parent's lane (down the list = older).
  for (const parentLane of input.row.parentLanes) {
    if (parentLane === input.row.lane) continue;
    const x0 = xs[input.row.lane]!;
    const x1 = xs[parentLane]!;
    const color = gitGraphLaneColor(input.row.lane);
    parts += `<path d="M ${x0} ${midY} C ${x0} ${input.rowHeight * 0.85}, ${x1} ${input.rowHeight * 0.85}, ${x1} ${input.rowHeight}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="0.85"/>`;
  }

  const nx = xs[input.row.lane]!;
  const nc = gitGraphLaneColor(input.row.lane);
  if (input.row.isMerge) {
    parts += `<circle cx="${nx}" cy="${midY}" r="${nodeRadius + 0.8}" fill="none" stroke="${nc}" stroke-width="1.5"/>`;
    parts += `<circle cx="${nx}" cy="${midY}" r="${Math.max(1.2, nodeRadius - 1)}" fill="${nc}"/>`;
  } else {
    parts += `<circle cx="${nx}" cy="${midY}" r="${nodeRadius}" fill="${nc}"/>`;
  }

  return `<svg viewBox="0 0 ${input.width} ${input.rowHeight}" width="${input.width}" height="${input.rowHeight}" aria-hidden="true">${parts}</svg>`;
}
