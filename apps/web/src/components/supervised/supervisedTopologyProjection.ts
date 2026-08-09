import type { SupervisedRuntimeSnapshot } from "@synara/contracts";

import { isPeerModelSessionRole } from "~/lib/supervisedOrchestration";

export function supervisedRoomRuns(
  snapshot: SupervisedRuntimeSnapshot,
  roomId: string,
): SupervisedRuntimeSnapshot["runs"] {
  const taskIds = new Set(
    snapshot.tasks.filter((task) => task.roomId === roomId).map((task) => task.id),
  );
  return snapshot.runs.filter(
    (run) => run.roomId === roomId || taskIds.has(run.taskId),
  );
}

export function supervisedRoomPeerSessions(
  snapshot: SupervisedRuntimeSnapshot,
  roomId: string,
): SupervisedRuntimeSnapshot["modelSessions"] {
  return snapshot.modelSessions
    .filter((session) => session.roomId === roomId && isPeerModelSessionRole(session.role))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .filter(
      (session, index, sessions) =>
        sessions.findIndex(
          (candidate) =>
            (candidate.threadId ?? candidate.peerSpecialtyId ?? candidate.id) ===
            (session.threadId ?? session.peerSpecialtyId ?? session.id),
        ) === index,
    );
}
