// FILE: ComposerOrchestratorChildStrip.logic.ts
// Purpose: Derives child-thread rows for the composer strip on an Orchestrator
// Root — same placement as the subagent strip, but rows are orchestrator children
// (ownership parent or MCP/native containment via sourceThreadId), not provider subagents.
// Layer: Chat composer logic
// Exports: deriveComposerOrchestratorChildStripItems and row types

import type {
  AssignmentContract,
  OrchestratorChildProjection,
  ThreadId,
} from "@synara/contracts";

import { orchestratorContainmentParentId } from "~/lib/orchestratorRoots";
import {
  projectOrchestratorSidebarChildren,
  type OrchestratorSidebarChild,
} from "../orchestrator/orchestratorSidebarProjection";

export type ComposerOrchestratorChildStatusKind =
  | "ready"
  | "running"
  | "waiting"
  | "blocked"
  | "failed"
  | "available";

export interface ComposerOrchestratorChildStripItem {
  readonly kind: "child";
  readonly key: string;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly statusLabel: string;
  readonly statusKind: ComposerOrchestratorChildStatusKind;
  readonly lane: "ready" | "working" | "available";
  readonly isActive: boolean;
  readonly isViewed: boolean;
  readonly additions: number | null;
  readonly deletions: number | null;
}

export interface ComposerOrchestratorChildStripCounts {
  readonly ready: number;
  readonly working: number;
  readonly available: number;
  readonly blocked: number;
}

export interface ComposerOrchestratorChildStripModel {
  readonly items: readonly ComposerOrchestratorChildStripItem[];
  readonly counts: ComposerOrchestratorChildStripCounts;
}

function statusKindForState(
  state: OrchestratorSidebarChild<never>["state"],
): ComposerOrchestratorChildStatusKind {
  switch (state) {
    case "ready":
      return "ready";
    case "working":
      return "running";
    case "waiting":
      return "waiting";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "available":
      return "available";
  }
}

function statusLabelForState(state: OrchestratorSidebarChild<never>["state"]): string {
  switch (state) {
    case "ready":
      return "ready";
    case "working":
      return "running";
    case "waiting":
      return "waiting";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
    case "available":
      return "available";
  }
}

export function orchestratorChildStatusDotClassName(
  statusKind: ComposerOrchestratorChildStatusKind,
): string {
  switch (statusKind) {
    case "ready":
      return "bg-orange-500";
    case "running":
      return "bg-violet-500 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-violet-500)_22%,transparent)]";
    case "waiting":
      return "bg-violet-400/70";
    case "blocked":
    case "failed":
      return "bg-destructive";
    case "available":
      return "bg-muted-foreground/35";
  }
}

export function orchestratorChildStatusTextToneClassName(
  statusKind: ComposerOrchestratorChildStatusKind,
): string {
  switch (statusKind) {
    case "ready":
      return "text-orange-600/85 dark:text-orange-400/85";
    case "running":
      return "text-violet-600/85 dark:text-violet-400/85";
    case "waiting":
      return "text-muted-foreground/70";
    case "blocked":
    case "failed":
      return "text-destructive/85";
    case "available":
      return "text-muted-foreground/55";
  }
}

export function deriveComposerOrchestratorChildStripItems(input: {
  readonly rootThreadId: ThreadId;
  readonly threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly title: string;
    readonly parentThreadId?: ThreadId | null;
    /** MCP / native orchestrator spawn: same containment fields as Sidebar. */
    readonly sourceThreadId?: ThreadId | null;
    readonly creationSource?: string | null;
    readonly createdAt: string;
    readonly updatedAt?: string | null | undefined;
  }>;
  readonly assignments: readonly AssignmentContract[];
  readonly childProjections?: readonly OrchestratorChildProjection[];
  readonly viewedThreadId?: ThreadId | null;
}): ComposerOrchestratorChildStripModel {
  // Match Sidebar: rewrite parent via containment so synara_mcp / orchestrator_native
  // children (parentThreadId null, sourceThreadId = root) appear in the strip.
  const threads = input.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    parentThreadId: orchestratorContainmentParentId(thread),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt ?? null,
  }));
  const projected = projectOrchestratorSidebarChildren({
    rootThreadId: input.rootThreadId,
    threads,
    assignments: input.assignments,
    ...(input.childProjections ? { childProjections: input.childProjections } : {}),
  });

  const items: ComposerOrchestratorChildStripItem[] = projected.map((child) => {
    const statusKind = statusKindForState(child.state);
    const diff = child.projection?.diffSummary;
    return {
      kind: "child",
      key: child.thread.id,
      threadId: child.thread.id,
      title: child.thread.title?.trim() || child.thread.id,
      statusLabel: statusLabelForState(child.state),
      statusKind,
      lane: child.lane,
      isActive: statusKind === "running" || statusKind === "waiting" || statusKind === "blocked",
      isViewed: input.viewedThreadId != null && child.thread.id === input.viewedThreadId,
      additions: diff?.additions ?? null,
      deletions: diff?.deletions ?? null,
    };
  });

  const counts: ComposerOrchestratorChildStripCounts = {
    ready: items.filter((item) => item.lane === "ready").length,
    working: items.filter((item) => item.lane === "working").length,
    available: items.filter((item) => item.lane === "available").length,
    blocked: items.filter((item) => item.statusKind === "blocked" || item.statusKind === "failed")
      .length,
  };

  return { items, counts };
}
