// FILE: turnWorkStatus.ts
// Purpose: Single shared Working→Worked lifecycle for normal chat and
// Supervised Lead Room. Normal mode is the product; Supervised adds governance chrome and routing.
// Layer: Chat turn work-status derivation
// Exports: deriveTurnWorkStatus, per-turn remount seed helpers

import type { ThreadId, TurnId } from "@synara/contracts";

import { deriveActiveWorkStartedAt, isLatestTurnSettled } from "./session-logic";

type TurnState = "error" | "running" | "interrupted" | "completed";

type LatestTurnView = {
  readonly turnId: TurnId;
  readonly state: TurnState | string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly requestedAt?: string | null;
} | null;

type SessionView = {
  readonly status?: string | null;
  readonly orchestrationStatus?: string | null;
  readonly activeTurnId?: TurnId | null | undefined;
} | null;

type TranscriptMessage = {
  readonly id?: string | null;
  readonly role: string;
  readonly createdAt?: string | null;
};

export type TurnWorkStatus = {
  /** Drives live Working row + collapseSettledTurns gate (MessagesTimeline). */
  readonly activeTurnInProgress: boolean;
  /** Continuous origin for this open turn only — never a prior settled turn. */
  readonly activeWorkStartedAt: string | null;
  /** Key for remount seed: latest user message id (or createdAt fallback). */
  readonly turnKey: string | null;
  /** Composer/transcript busy signal aligned with in-progress work. */
  readonly isWorking: boolean;
};

/**
 * True when the transcript ends on a user message that still has no settled
 * assistant answer. Used for remount survival — not a second Working path.
 *
 * Intentionally does NOT treat a bare leftover `activeTurnId` as in-flight when
 * the session is no longer running and the latest turn is completed (that sticky
 * id kept Working counting after the answer landed).
 */
export function hasOpenUserTurnAwaitingAnswer(input: {
  readonly messages: ReadonlyArray<TranscriptMessage>;
  readonly latestTurn: LatestTurnView;
  readonly session: SessionView;
}): boolean {
  let lastRole: string | null = null;
  let lastCreatedAt: string | null = null;
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (!message) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    lastRole = message.role;
    lastCreatedAt = message.createdAt ?? null;
    break;
  }
  if (lastRole !== "user") {
    return false;
  }

  const session = input.session;
  if (
    session?.status === "running" ||
    session?.status === "connecting" ||
    session?.orchestrationStatus === "running" ||
    session?.orchestrationStatus === "starting"
  ) {
    return true;
  }

  const latestTurn = input.latestTurn;
  if (!latestTurn) {
    return true;
  }
  if (
    latestTurn.completedAt == null &&
    latestTurn.state !== "interrupted" &&
    latestTurn.state !== "error"
  ) {
    return true;
  }
  if (
    lastCreatedAt != null &&
    latestTurn.completedAt != null &&
    lastCreatedAt > latestTurn.completedAt
  ) {
    return true;
  }
  return false;
}

function readLatestUserBoundary(
  messages: ReadonlyArray<TranscriptMessage>,
): { readonly turnKey: string; readonly createdAt: string } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "user") continue;
    const createdAt = message.createdAt ?? null;
    if (!createdAt) continue;
    const turnKey =
      typeof message.id === "string" && message.id.length > 0 ? message.id : createdAt;
    return { turnKey, createdAt };
  }
  return null;
}

function readLastUserOrAssistantRole(
  messages: ReadonlyArray<TranscriptMessage>,
): "user" | "assistant" | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user" || message.role === "assistant") {
      return message.role;
    }
  }
  return null;
}

/**
 * True when localDispatch is a *new* send that has not projected its user row yet
 * (transcript still ends on a prior assistant). In that case the latest user
 * boundary belongs to the previous turn and must not own the open work clock.
 */
function isProvisionalNewSendWithoutUserRow(input: {
  readonly messages: ReadonlyArray<TranscriptMessage>;
  readonly localDispatchActive: boolean;
  readonly localDispatchStartedAt: string | null;
}): boolean {
  if (!input.localDispatchActive || !input.localDispatchStartedAt) {
    return false;
  }
  if (readLastUserOrAssistantRole(input.messages) === "user") {
    return false;
  }
  const userBoundary = readLatestUserBoundary(input.messages);
  if (!userBoundary) {
    return true;
  }
  const sendMs = Date.parse(input.localDispatchStartedAt);
  const userMs = Date.parse(userBoundary.createdAt);
  if (!Number.isFinite(sendMs) || !Number.isFinite(userMs)) {
    return true;
  }
  // Dispatch after the last user row ⇒ that user is a prior turn.
  return sendMs > userMs + 250;
}

/** Open-turn seed key shared by ChatView remount persistence and deriveTurnWorkStatus. */
export function resolveTurnWorkKey(input: {
  readonly messages: ReadonlyArray<TranscriptMessage>;
  readonly localDispatchActive: boolean;
  readonly localDispatchStartedAt: string | null;
}): string | null {
  const userBoundary = readLatestUserBoundary(input.messages);
  if (isProvisionalNewSendWithoutUserRow(input)) {
    return `send:${input.localDispatchStartedAt}`;
  }
  if (userBoundary) {
    return userBoundary.turnKey;
  }
  if (input.localDispatchActive && input.localDispatchStartedAt) {
    return `send:${input.localDispatchStartedAt}`;
  }
  return null;
}

/**
 * Shared turn work-status for normal and Supervised sessions. Presentation stays in
 * MessagesTimeline (Working→Worked from 66f9b3f8); this only feeds its gates.
 */
export function deriveTurnWorkStatus(input: {
  readonly threadError?: string | null | undefined;
  readonly messages: ReadonlyArray<TranscriptMessage>;
  readonly latestTurn: LatestTurnView;
  readonly session: SessionView;
  readonly localDispatchActive: boolean;
  readonly localDispatchStartedAt: string | null;
  readonly isConnecting: boolean;
  readonly hasLiveTurn: boolean;
  readonly hasLiveTurnTail: boolean;
  /**
   * Assistant text still streaming on the open turn. Keeps the live Working row
   * mounted when session "running" flaps off early (common on delegated /
   * Grok) so the status does not blank mid-turn.
   */
  readonly hasStreamingAssistantText?: boolean;
  /** Remount seed for the *current* turnKey only (see rememberTurnWorkStartedAt). */
  readonly persistedStartedAtForTurn: string | null;
}): TurnWorkStatus {
  if (input.threadError) {
    return {
      activeTurnInProgress: false,
      activeWorkStartedAt: null,
      turnKey: readLatestUserBoundary(input.messages)?.turnKey ?? null,
      isWorking: false,
    };
  }

  const lastRole = readLastUserOrAssistantRole(input.messages);
  const userBoundary = readLatestUserBoundary(input.messages);
  const provisionalNewSend = isProvisionalNewSendWithoutUserRow({
    messages: input.messages,
    localDispatchActive: input.localDispatchActive,
    localDispatchStartedAt: input.localDispatchStartedAt,
  });
  const turnKey = resolveTurnWorkKey({
    messages: input.messages,
    localDispatchActive: input.localDispatchActive,
    localDispatchStartedAt: input.localDispatchStartedAt,
  });

  // Narrow to session-logic shapes without exactOptionalPropertyTypes fights.
  const latestTurnForSettle =
    input.latestTurn?.startedAt != null
      ? {
          turnId: input.latestTurn.turnId,
          state: input.latestTurn.state as TurnState,
          startedAt: input.latestTurn.startedAt,
          completedAt: input.latestTurn.completedAt,
        }
      : null;
  const sessionForSettle = input.session
    ? ({
        orchestrationStatus: input.session.orchestrationStatus ?? "ready",
        ...(input.session.activeTurnId != null ? { activeTurnId: input.session.activeTurnId } : {}),
      } as Parameters<typeof isLatestTurnSettled>[1])
    : null;
  const latestTurnSettled = isLatestTurnSettled(latestTurnForSettle, sessionForSettle);
  // Match morning ChatView: localDispatch | connecting | hasLiveTurn | unsettled latest turn.
  // Awaiting-answer covers remount gaps only (user tail, no live session signals yet).
  const latestTurnInProgress = Boolean(input.latestTurn?.requestedAt) && !latestTurnSettled;

  const awaitingAnswer = hasOpenUserTurnAwaitingAnswer({
    messages: input.messages,
    latestTurn: input.latestTurn,
    session: input.session,
  });

  // Streaming assistant keeps the live Working row even if session status
  // briefly leaves "running" (provider status flaps can otherwise cause a blank flick).
  const streamingOpenTurn = input.hasStreamingAssistantText === true && lastRole === "assistant";

  const activeTurnInProgress =
    input.localDispatchActive ||
    input.isConnecting ||
    input.hasLiveTurn ||
    latestTurnInProgress ||
    awaitingAnswer ||
    streamingOpenTurn ||
    // Live tool/tail work without a running session flag still owns the header.
    (input.hasLiveTurnTail && lastRole === "user");

  const workStatusInFlight = activeTurnInProgress;
  // Continuous origin for *this* open turn (morning deriveActiveWorkStartedAt order).
  // Keep the latest user boundary while the assistant streams/settles so startedAt
  // does not jump when lastRole flips user→assistant (that jump restarts the clock
  // and kills the smooth Working→Worked handoff).
  // Only skip the user boundary on a provisional new send that has no user row yet.
  const userMessageStartedAt =
    (workStatusInFlight || input.hasLiveTurnTail) && userBoundary && !provisionalNewSend
      ? userBoundary.createdAt
      : null;

  const derivedStartedAt = workStatusInFlight
    ? deriveActiveWorkStartedAt(
        latestTurnForSettle,
        sessionForSettle,
        input.localDispatchStartedAt,
        userMessageStartedAt,
      )
    : input.hasLiveTurnTail
      ? (userMessageStartedAt ?? input.latestTurn?.startedAt ?? null)
      : null;

  // Prefer this turn's durable user origin over a remount seed; never take a
  // seed from another turn (caller must pass null when turnKey mismatches).
  let activeWorkStartedAt: string | null = null;
  if (workStatusInFlight || input.hasLiveTurnTail) {
    if (derivedStartedAt && input.persistedStartedAtForTurn) {
      const derivedMs = Date.parse(derivedStartedAt);
      const persistedMs = Date.parse(input.persistedStartedAtForTurn);
      activeWorkStartedAt =
        Number.isFinite(derivedMs) && Number.isFinite(persistedMs) && persistedMs < derivedMs
          ? input.persistedStartedAtForTurn
          : derivedStartedAt;
    } else {
      activeWorkStartedAt = derivedStartedAt ?? input.persistedStartedAtForTurn;
    }
  }

  return {
    activeTurnInProgress,
    activeWorkStartedAt,
    turnKey,
    isWorking: activeTurnInProgress,
  };
}

// --- Per-turn remount seed (survives ChatView remount; resets on new user send) ---

type TurnSeed = { readonly turnKey: string; readonly startedAt: string };

const turnSeedByThreadId = new Map<string, TurnSeed>();

function parseTime(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

/** Remember startedAt for this turn only; a new turnKey replaces the prior seed. */
export function rememberTurnWorkStartedAt(
  threadId: ThreadId,
  turnKey: string,
  startedAt: string,
): void {
  const existing = turnSeedByThreadId.get(threadId);
  if (!existing || existing.turnKey !== turnKey) {
    turnSeedByThreadId.set(threadId, { turnKey, startedAt });
    return;
  }
  if (parseTime(startedAt) < parseTime(existing.startedAt)) {
    turnSeedByThreadId.set(threadId, { turnKey, startedAt });
  }
}

export function readTurnWorkStartedAt(threadId: ThreadId, turnKey: string | null): string | null {
  if (turnKey == null) return null;
  const existing = turnSeedByThreadId.get(threadId);
  if (!existing || existing.turnKey !== turnKey) return null;
  return existing.startedAt;
}

export function clearTurnWorkStartedAt(threadId: ThreadId): void {
  turnSeedByThreadId.delete(threadId);
}

/** Test / HMR isolation only. */
export function resetTurnWorkStatusForTests(): void {
  turnSeedByThreadId.clear();
}
