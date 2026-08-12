// FILE: processDiagnostics.ts
// Purpose: Reads, bounds, and redacts descendant process diagnostics for the server status API.
// Layer: Server diagnostics

import { execFile } from "node:child_process";

import { redactSensitiveProcessArgs } from "../processArgumentRedaction";

export const MAX_DIAGNOSTIC_CHILD_PROCESSES = 80;
const MAX_DIAGNOSTIC_ARGS_CHARS = 500;

export interface ProcessTableRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssBytes: number;
  readonly virtualSizeBytes: number;
  readonly command: string;
  readonly args: string;
}

function redactAndTruncateProcessArgs(args: string): string {
  const redacted = redactSensitiveProcessArgs(args);
  return redacted.length > MAX_DIAGNOSTIC_ARGS_CHARS
    ? `${redacted.slice(0, MAX_DIAGNOSTIC_ARGS_CHARS - 15)}... [truncated]`
    : redacted;
}

export function parseProcessTable(output: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1_024,
      virtualSizeBytes: Number(match[4]) * 1_024,
      command: match[5] ?? "",
      args: redactAndTruncateProcessArgs(match[6] ?? ""),
    });
  }
  return rows;
}

export function collectDescendantProcesses(
  rows: readonly ProcessTableRow[],
  rootPid: number,
): ProcessTableRow[] {
  const childrenByParent = new Map<number, ProcessTableRow[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row);
    childrenByParent.set(row.ppid, children);
  }
  const descendants: ProcessTableRow[] = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop()!;
    descendants.push(row);
    stack.push(...(childrenByParent.get(row.pid) ?? []));
  }
  return descendants.toSorted((left, right) => right.rssBytes - left.rssBytes);
}

export function readDescendantProcesses(rootPid: number): Promise<ProcessTableRow[]> {
  if (process.platform === "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,rss=,vsz=,comm=,args="],
      { maxBuffer: 2 * 1_024 * 1_024 },
      (_error, stdout) => resolve(collectDescendantProcesses(parseProcessTable(stdout), rootPid)),
    );
  });
}
