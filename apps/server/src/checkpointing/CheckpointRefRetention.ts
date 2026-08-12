import { CheckpointRef, ThreadId, TurnId } from "@veylen/contracts";
import { Cause, Effect, Layer, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointStore } from "./Services/CheckpointStore.ts";

export const CHECKPOINT_RETAINED_TURN_LIMIT = 50;

export interface QueueCheckpointRefCleanupInput {
  readonly cwd: string;
  readonly checkpointRef: CheckpointRef;
  readonly threadId: ThreadId;
  readonly turnId: TurnId | null;
  readonly refKind: "turn" | "turn_start" | "message_start";
  readonly now: string;
}

export interface CheckpointRefRetentionShape {
  readonly queue: (input: QueueCheckpointRefCleanupInput) => Effect.Effect<void>;
  readonly drain: () => Effect.Effect<void>;
}

export class CheckpointRefRetention extends ServiceMap.Service<
  CheckpointRefRetention,
  CheckpointRefRetentionShape
>()("veylen/checkpointing/CheckpointRefRetention") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const checkpointStore = yield* CheckpointStore;

  const queue: CheckpointRefRetentionShape["queue"] = (input) =>
    sql`
      INSERT INTO checkpoint_ref_cleanup_queue (
        cwd, checkpoint_ref, thread_id, turn_id, ref_kind, state,
        attempt_count, last_error, created_at, updated_at
      ) VALUES (
        ${input.cwd}, ${input.checkpointRef}, ${input.threadId}, ${input.turnId},
        ${input.refKind}, 'pending', 0, NULL, ${input.now}, ${input.now}
      )
      ON CONFLICT (cwd, checkpoint_ref) DO UPDATE SET
        thread_id = excluded.thread_id,
        turn_id = excluded.turn_id,
        ref_kind = excluded.ref_kind,
        state = CASE
          WHEN checkpoint_ref_cleanup_queue.state = 'deleted' THEN 'deleted'
          ELSE 'pending'
        END,
        last_error = NULL,
        updated_at = excluded.updated_at
    `.pipe(
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Effect.logWarning("checkpoint retention queue write failed", {
          threadId: input.threadId,
          checkpointRef: input.checkpointRef,
          cause: Cause.pretty(cause),
        }),
      ),
    );

  const drain: CheckpointRefRetentionShape["drain"] = () =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        readonly cwd: string;
        readonly checkpointRef: string;
        readonly threadId: string;
      }>`
        SELECT cwd, checkpoint_ref AS "checkpointRef", thread_id AS "threadId"
        FROM checkpoint_ref_cleanup_queue
        WHERE state IN ('pending', 'failed')
        ORDER BY updated_at, cwd, checkpoint_ref
        LIMIT 256
      `.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("checkpoint retention queue read failed", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as([])),
        ),
      );
      yield* Effect.forEach(
        rows,
        (row) =>
          checkpointStore
            .deleteCheckpointRefs({
              cwd: row.cwd,
              checkpointRefs: [CheckpointRef.makeUnsafe(row.checkpointRef)],
            })
            .pipe(
              Effect.andThen(
                sql`
                  UPDATE checkpoint_ref_cleanup_queue
                  SET state = 'deleted', attempt_count = attempt_count + 1,
                      last_error = NULL, updated_at = ${new Date().toISOString()}
                  WHERE cwd = ${row.cwd} AND checkpoint_ref = ${row.checkpointRef}
                `,
              ),
              Effect.catchCause((cause) =>
                sql`
                  UPDATE checkpoint_ref_cleanup_queue
                  SET state = 'failed', attempt_count = attempt_count + 1,
                      last_error = ${Cause.pretty(cause)}, updated_at = ${new Date().toISOString()}
                  WHERE cwd = ${row.cwd} AND checkpoint_ref = ${row.checkpointRef}
                `.pipe(
                  Effect.catchCause(() => Effect.void),
                  Effect.andThen(
                    Effect.logWarning("checkpoint retention cleanup failed", {
                      threadId: row.threadId,
                      checkpointRef: row.checkpointRef,
                      cause: Cause.pretty(cause),
                    }),
                  ),
                ),
              ),
            ),
        { concurrency: 1, discard: true },
      );
    });

  return CheckpointRefRetention.of({ queue, drain });
});

export const CheckpointRefRetentionLive = Layer.effect(CheckpointRefRetention, make);
