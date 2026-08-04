import type { SupervisionSnapshot, SupervisorSeatId, ThreadId } from "@synara/contracts";

export type SupervisorSeatRouteState =
  | { readonly kind: "ready"; readonly activeThreadId: ThreadId }
  | { readonly kind: "archived"; readonly activeThreadId: ThreadId }
  | { readonly kind: "missing" };

export function resolveSupervisorSeatRouteState(
  snapshot: SupervisionSnapshot,
  supervisorSeatId: SupervisorSeatId,
): SupervisorSeatRouteState {
  const seat = snapshot.supervisors.find((candidate) => candidate.id === supervisorSeatId);
  if (!seat) return { kind: "missing" };
  return seat.status === "archived"
    ? { kind: "archived", activeThreadId: seat.activeThreadId }
    : { kind: "ready", activeThreadId: seat.activeThreadId };
}
