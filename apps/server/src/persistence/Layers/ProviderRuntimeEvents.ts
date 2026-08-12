import { NonNegativeInt, ProviderRuntimeEvent } from "@veylen/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  PersistenceDecodeError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../Errors.ts";
import {
  PROVIDER_RUNTIME_EVENT_MAX_BYTES,
  PROVIDER_RUNTIME_EVENT_FAILURE_ATTEMPT_LIMIT,
  PROVIDER_RUNTIME_EVENT_FAILURE_MIN_AGE_MS,
  PROVIDER_RUNTIME_EVENT_RETAIN_ACCEPTED,
  ProviderRuntimeEventRepository,
  type PersistedProviderRuntimeEvent,
  type ProviderRuntimeEventRepositoryShape,
} from "../Services/ProviderRuntimeEvents.ts";

/**
 * How far the consumer cursor may advance between journal retention scans.
 *
 * Retention keeps every event of an open turn plus a trailing diagnostic tail,
 * so while a turn streams there is nothing new to delete, yet the scan has no
 * lower bound and re-probes the whole retained backlog on every single event —
 * quadratic in the length of a turn (measured: 1.38 ms/event at 8k events,
 * 3.07 ms/event at 16k events, ~25 s cumulative).
 *
 * Scanning once per interval instead makes that cost linear-ish while changing
 * nothing about what is retained: skipping a scan can only delay a delete, and
 * every event that settles a turn forces a scan immediately, so the backlog of
 * a finished turn is still released as soon as it becomes deletable. The bound
 * on extra retained rows is one interval's worth of accepted events.
 *
 * Deliberately matched to PROVIDER_RUNTIME_EVENT_RETAIN_ACCEPTED: roughly one
 * scan per tail-length of accepted events falling out of the diagnostic tail.
 */
const PROVIDER_RUNTIME_EVENT_RETENTION_SCAN_INTERVAL = PROVIDER_RUNTIME_EVENT_RETAIN_ACCEPTED;

const ProviderRuntimeEventJson = Schema.fromJsonString(ProviderRuntimeEvent);
const encodeEvent = Schema.encodeEffect(ProviderRuntimeEventJson);
const decodeEvent = Schema.decodeUnknownEffect(ProviderRuntimeEventJson);

const StoredRowSchema = Schema.Struct({
  sequence: NonNegativeInt,
  eventJson: Schema.String,
});
const decodeStoredRow = Schema.decodeUnknownEffect(StoredRowSchema);

const encodePersistableEvent = (event: ProviderRuntimeEvent) =>
  Effect.gen(function* () {
    const eventJson = yield* encodeEvent(event).pipe(
      Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.append.encode")),
    );
    const originalBytes = Buffer.byteLength(eventJson, "utf8");
    if (originalBytes <= PROVIDER_RUNTIME_EVENT_MAX_BYTES) {
      return { event, eventJson };
    }

    if (event.raw !== undefined) {
      const compactedEvent = {
        ...event,
        raw: {
          source: event.raw.source,
          ...(event.raw.method !== undefined ? { method: event.raw.method } : {}),
          ...(event.raw.messageType !== undefined ? { messageType: event.raw.messageType } : {}),
          payload: {
            veylenTruncated: true,
            reason: "provider runtime event exceeded the durable journal size limit",
            originalBytes,
          },
        },
      } satisfies ProviderRuntimeEvent;
      const compactedJson = yield* encodeEvent(compactedEvent).pipe(
        Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.append.compact")),
      );
      if (Buffer.byteLength(compactedJson, "utf8") <= PROVIDER_RUNTIME_EVENT_MAX_BYTES) {
        return { event: compactedEvent, eventJson: compactedJson };
      }
    }

    return yield* new PersistenceDecodeError({
      operation: "ProviderRuntimeEvent.append",
      issue: `Provider runtime event exceeds ${PROVIDER_RUNTIME_EVENT_MAX_BYTES} bytes after raw payload compaction.`,
    });
  });

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const append: ProviderRuntimeEventRepositoryShape["append"] = (event) =>
    Effect.gen(function* () {
      const persistable = yield* encodePersistableEvent(event);
      const persistedEvent = persistable.event;
      const eventJson = persistable.eventJson;
      const rows = yield* sql<Record<string, unknown>>`
            INSERT INTO provider_runtime_events (
              event_id, thread_id, turn_id, lifecycle_generation, event_type,
              event_json, persisted_at
            ) VALUES (
              ${event.eventId}, ${event.threadId}, ${event.turnId ?? null},
              ${event.lifecycleGeneration ?? null},
              ${event.type}, ${eventJson}, ${new Date().toISOString()}
            )
            ON CONFLICT(event_id) DO UPDATE SET event_id = excluded.event_id
            RETURNING sequence, event_json AS "eventJson"
          `
        .pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.append")));
      const row = yield* decodeStoredRow(rows[0]).pipe(
        Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.append.row")),
      );
      if (row.eventJson !== eventJson) {
        return yield* new PersistenceDecodeError({
          operation: "ProviderRuntimeEvent.append",
          issue: `Provider event '${event.eventId}' was reused with different content.`,
        });
      }
      return {
        sequence: row.sequence,
        event: persistedEvent,
      } satisfies PersistedProviderRuntimeEvent;
    });

  const getHighWaterSequence = sql<{ readonly highWaterSequence: number }>`
    SELECT COALESCE(MAX(sequence), 0) AS "highWaterSequence"
    FROM provider_runtime_events
  `.pipe(
    Effect.map((rows) => rows[0]?.highWaterSequence ?? 0),
    Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.getHighWaterSequence")),
  );

  const readAfter: ProviderRuntimeEventRepositoryShape["readAfter"] = (input) => {
    const limit = Math.max(1, Math.min(1_000, Math.floor(input.limit)));
    return Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT sequence, event_json AS "eventJson"
        FROM provider_runtime_events
        WHERE sequence > ${input.sequenceExclusive}
          AND sequence <= ${input.throughSequenceInclusive}
        ORDER BY sequence ASC
        LIMIT ${limit}
      `.pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.readAfter")));
      return yield* Effect.forEach(
        rows,
        (unknownRow) =>
          Effect.gen(function* () {
            const row = yield* decodeStoredRow(unknownRow).pipe(
              Effect.mapError(toPersistenceDecodeError("ProviderRuntimeEvent.readAfter.row")),
            );
            const event = yield* decodeEvent(row.eventJson).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  `ProviderRuntimeEvent.readAfter(sequence=${row.sequence})`,
                ),
              ),
            );
            return { sequence: row.sequence, event } satisfies PersistedProviderRuntimeEvent;
          }),
        { concurrency: 1 },
      );
    });
  };

  const readPending: ProviderRuntimeEventRepositoryShape["readPending"] = (input) => {
    const limit = Math.max(1, Math.min(1_000, Math.floor(input.limit)));
    return Effect.gen(function* () {
      const cursor = yield* getConsumerCursor(input.consumerName);
      const rows = yield* sql<Record<string, unknown>>`
        SELECT event.sequence, event.event_json AS "eventJson"
        FROM provider_runtime_events AS event
        LEFT JOIN provider_runtime_event_deliveries AS delivery
          ON delivery.consumer_name = ${input.consumerName}
         AND delivery.event_sequence = event.sequence
        WHERE event.sequence > ${cursor}
          AND event.sequence <= ${input.throughSequenceInclusive}
          AND (delivery.status IS NULL OR delivery.status = 'retry')
        ORDER BY event.sequence ASC
        LIMIT ${limit}
      `.pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.readPending")));
      return yield* Effect.forEach(
        rows,
        (unknownRow) =>
          Effect.gen(function* () {
            const row = yield* decodeStoredRow(unknownRow).pipe(
              Effect.mapError(
                toPersistenceDecodeError("ProviderRuntimeEvent.readPending.row"),
              ),
            );
            const event = yield* decodeEvent(row.eventJson).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  `ProviderRuntimeEvent.readPending(sequence=${row.sequence})`,
                ),
              ),
            );
            return { sequence: row.sequence, event } satisfies PersistedProviderRuntimeEvent;
          }),
        { concurrency: 1 },
      );
    });
  };

  const getThreadCoverage: ProviderRuntimeEventRepositoryShape["getThreadCoverage"] = (threadId) =>
    sql<{
      readonly retainedCount: number;
      readonly oldestSequence: number | null;
      readonly highWaterSequence: number;
    }>`
      SELECT
        COUNT(*) AS "retainedCount",
        MIN(sequence) AS "oldestSequence",
        COALESCE(MAX(sequence), 0) AS "highWaterSequence"
      FROM provider_runtime_events
      WHERE thread_id = ${threadId}
    `.pipe(
      Effect.map(
        (rows) => rows[0] ?? { retainedCount: 0, oldestSequence: null, highWaterSequence: 0 },
      ),
      Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.getThreadCoverage")),
    );

  const readThreadEvents: ProviderRuntimeEventRepositoryShape["readThreadEvents"] = (input) => {
    const beforeSequence = input.beforeSequenceExclusive ?? Number.MAX_SAFE_INTEGER;
    const turnFilter = input.turnId === undefined ? sql`` : sql`AND turn_id = ${input.turnId}`;
    const typeFilter =
      input.eventTypes === undefined || input.eventTypes.length === 0
        ? sql``
        : sql`AND event_type IN ${sql.in(input.eventTypes)}`;
    return Effect.gen(function* () {
      const rows = yield* sql<Record<string, unknown>>`
        SELECT sequence, event_json AS "eventJson"
        FROM provider_runtime_events
        WHERE thread_id = ${input.threadId}
          AND sequence <= ${input.throughSequenceInclusive}
          AND sequence < ${beforeSequence}
          ${turnFilter}
          ${typeFilter}
        ORDER BY sequence DESC
        LIMIT ${Math.max(1, Math.min(201, Math.floor(input.limit)))}
      `.pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.readThreadEvents")));
      return yield* Effect.forEach(
        rows,
        (unknownRow) =>
          Effect.gen(function* () {
            const row = yield* decodeStoredRow(unknownRow).pipe(
              Effect.mapError(
                toPersistenceDecodeError("ProviderRuntimeEvent.readThreadEvents.row"),
              ),
            );
            const event = yield* decodeEvent(row.eventJson).pipe(
              Effect.mapError(
                toPersistenceDecodeError(
                  `ProviderRuntimeEvent.readThreadEvents(sequence=${row.sequence})`,
                ),
              ),
            );
            return { sequence: row.sequence, event } satisfies PersistedProviderRuntimeEvent;
          }),
        { concurrency: 1 },
      );
    });
  };

  const readAcceptedOpenTurnEvents: ProviderRuntimeEventRepositoryShape["readAcceptedOpenTurnEvents"] =
    (input) => {
      const limit = Math.max(1, Math.min(1_000, Math.floor(input.limit)));
      return Effect.gen(function* () {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT event.sequence, event.event_json AS "eventJson"
          FROM provider_runtime_events AS event
          INNER JOIN provider_runtime_open_turns AS open_turn
            ON open_turn.thread_id = event.thread_id
           AND open_turn.turn_id = event.turn_id
           AND event.sequence >= open_turn.first_sequence
          INNER JOIN provider_runtime_event_deliveries AS delivery
            ON delivery.consumer_name = ${input.consumerName}
           AND delivery.event_sequence = event.sequence
           AND delivery.status = 'accepted'
          WHERE event.sequence > ${input.sequenceExclusive}
          ORDER BY event.sequence ASC
          LIMIT ${limit}
        `.pipe(
          Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.readAcceptedOpenTurnEvents")),
        );
        return yield* Effect.forEach(
          rows,
          (unknownRow) =>
            Effect.gen(function* () {
              const row = yield* decodeStoredRow(unknownRow).pipe(
                Effect.mapError(
                  toPersistenceDecodeError("ProviderRuntimeEvent.readAcceptedOpenTurnEvents.row"),
                ),
              );
              const event = yield* decodeEvent(row.eventJson).pipe(
                Effect.mapError(
                  toPersistenceDecodeError(
                    `ProviderRuntimeEvent.readAcceptedOpenTurnEvents(sequence=${row.sequence})`,
                  ),
                ),
              );
              return { sequence: row.sequence, event } satisfies PersistedProviderRuntimeEvent;
            }),
          { concurrency: 1 },
        );
      });
    };

  const pruneSettledOpenTurns: ProviderRuntimeEventRepositoryShape["pruneSettledOpenTurns"] = sql`
      DELETE FROM provider_runtime_open_turns
      WHERE EXISTS (
        SELECT 1
        FROM projection_turns AS turn
        WHERE turn.thread_id = provider_runtime_open_turns.thread_id
          AND turn.turn_id = provider_runtime_open_turns.turn_id
          AND turn.state IN ('interrupted', 'completed', 'error')
      )
    `.pipe(
    Effect.asVoid,
    Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.pruneSettledOpenTurns")),
  );

  const getConsumerCursor: ProviderRuntimeEventRepositoryShape["getConsumerCursor"] = (
    consumerName,
  ) =>
    sql<{ readonly lastAckedSequence: number }>`
        SELECT last_acked_sequence AS "lastAckedSequence"
        FROM provider_runtime_event_consumers
        WHERE consumer_name = ${consumerName}
      `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.fail(
              new PersistenceDecodeError({
                operation: "ProviderRuntimeEvent.getConsumerCursor",
                issue: `Consumer '${consumerName}' is not registered.`,
              }),
            )
          : Effect.succeed(rows[0].lastAckedSequence),
      ),
      Effect.mapError((error) =>
        error instanceof PersistenceDecodeError
          ? error
          : toPersistenceSqlError("ProviderRuntimeEvent.getConsumerCursor")(error),
      ),
    );

  const hasPendingEventsForThreads: ProviderRuntimeEventRepositoryShape["hasPendingEventsForThreads"] =
    (input) => {
      if (input.threadIds.length === 0) return Effect.succeed(false);
      return Effect.gen(function* () {
        const rows = yield* sql<{ readonly present: number }>`
          SELECT 1 AS present
          FROM provider_runtime_events AS event
          LEFT JOIN provider_runtime_event_deliveries AS delivery
            ON delivery.consumer_name = ${input.consumerName}
           AND delivery.event_sequence = event.sequence
          WHERE event.thread_id IN ${sql.in(input.threadIds)}
            AND (delivery.status IS NULL OR delivery.status = 'retry')
          LIMIT 1
        `.pipe(
          Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.hasPendingEventsForThreads")),
        );
        return rows.length > 0;
      });
    };

  // Highest cursor position whose retention scan has already run. Process-local
  // on purpose: it is a "do not rescan yet" hint, never a durability record. A
  // restart resets it to 0, which makes the next cursor advance scan — the safe
  // direction, since the only effect of losing it is pruning sooner.
  let lastRetentionScanSequence = 0;

  const compactSettledConsumerCursor = (consumerName: string, updatedAt: string) =>
    Effect.gen(function* () {
      const consumerRows = yield* sql<{ readonly lastAckedSequence: number }>`
        SELECT last_acked_sequence AS "lastAckedSequence"
        FROM provider_runtime_event_consumers
        WHERE consumer_name = ${consumerName}
      `;
      const cursor = consumerRows[0]?.lastAckedSequence;
      if (cursor === undefined) return null;

      const unsettledRows = yield* sql<{ readonly sequence: number | null }>`
        SELECT MIN(event.sequence) AS sequence
        FROM provider_runtime_events AS event
        LEFT JOIN provider_runtime_event_deliveries AS delivery
          ON delivery.consumer_name = ${consumerName}
         AND delivery.event_sequence = event.sequence
        WHERE event.sequence > ${cursor}
          AND (delivery.status IS NULL OR delivery.status = 'retry')
      `;
      const firstUnsettled = unsettledRows[0]?.sequence ?? null;
      const targetRows = yield* sql<{ readonly sequence: number | null }>`
        SELECT MAX(event.sequence) AS sequence
        FROM provider_runtime_events AS event
        INNER JOIN provider_runtime_event_deliveries AS delivery
          ON delivery.consumer_name = ${consumerName}
         AND delivery.event_sequence = event.sequence
         AND delivery.status IN ('accepted', 'dead_letter')
        WHERE event.sequence > ${cursor}
          AND (${firstUnsettled} IS NULL OR event.sequence < ${firstUnsettled})
      `;
      const target = targetRows[0]?.sequence ?? cursor;
      if (target > cursor) {
        yield* sql`
          UPDATE provider_runtime_event_consumers
          SET last_acked_sequence = ${target}, updated_at = ${updatedAt}
          WHERE consumer_name = ${consumerName}
        `;
      }
      return target;
    });

  const trackAcceptedTurn = (input: {
    readonly eventSequence: number;
    readonly eventType: string;
    readonly threadId: string;
    readonly turnId: string | null;
    readonly updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const isTerminalTurnEvent =
        input.eventType === "turn.completed" || input.eventType === "turn.aborted";
      const isThreadTerminalEvent =
        input.eventType === "session.exited" || input.eventType === "runtime.error";
      if (input.turnId !== null && !isTerminalTurnEvent && !isThreadTerminalEvent) {
        yield* sql`
          INSERT INTO provider_runtime_open_turns (
            thread_id, turn_id, first_sequence, updated_at
          ) VALUES (
            ${input.threadId}, ${input.turnId}, ${input.eventSequence}, ${input.updatedAt}
          )
          ON CONFLICT (thread_id, turn_id) DO UPDATE SET
            first_sequence = MIN(provider_runtime_open_turns.first_sequence, excluded.first_sequence),
            updated_at = excluded.updated_at
        `;
      } else if (input.turnId !== null) {
        yield* sql`
          DELETE FROM provider_runtime_open_turns
          WHERE thread_id = ${input.threadId} AND turn_id = ${input.turnId}
        `;
      } else if (isThreadTerminalEvent) {
        yield* sql`
          DELETE FROM provider_runtime_open_turns
          WHERE thread_id = ${input.threadId}
        `;
      } else if (isTerminalTurnEvent) {
        yield* sql`
          DELETE FROM provider_runtime_open_turns
          WHERE thread_id = ${input.threadId}
            AND 1 = (
              SELECT COUNT(*) FROM provider_runtime_open_turns
              WHERE thread_id = ${input.threadId}
            )
        `;
      }
      return isTerminalTurnEvent || isThreadTerminalEvent;
    });

  const pruneAcceptedHistory = (cursor: number) =>
    sql`
      DELETE FROM provider_runtime_events AS event
      WHERE event.sequence <= ${cursor}
        AND NOT EXISTS (
          SELECT 1
          FROM provider_runtime_open_turns AS open_turn
          WHERE open_turn.thread_id = event.thread_id
            AND open_turn.turn_id = event.turn_id
            AND event.sequence >= open_turn.first_sequence
        )
        AND event.sequence NOT IN (
          SELECT sequence
          FROM provider_runtime_events
          WHERE sequence <= ${cursor}
          ORDER BY sequence DESC
          LIMIT ${PROVIDER_RUNTIME_EVENT_RETAIN_ACCEPTED}
        )
    `;

  const advanceConsumerCursor: ProviderRuntimeEventRepositoryShape["advanceConsumerCursor"] = (
    input,
  ) => {
    let retentionScanSequence: number | null = null;
    return sql
      .withTransaction(
        Effect.gen(function* () {
          const eventRows = yield* sql<{
            readonly eventType: string;
            readonly threadId: string;
            readonly turnId: string | null;
          }>`
            SELECT event_type AS "eventType", thread_id AS "threadId", turn_id AS "turnId"
            FROM provider_runtime_events
            WHERE sequence = ${input.eventSequence}
          `;
          const event = eventRows[0];
          if (!event) return false;

          yield* sql`
            INSERT INTO provider_runtime_event_deliveries (
              consumer_name, event_sequence, status, attempt_count, updated_at
            ) VALUES (
              ${input.consumerName}, ${input.eventSequence}, 'accepted', 0, ${input.updatedAt}
            )
            ON CONFLICT (consumer_name, event_sequence) DO UPDATE SET
              status = 'accepted', updated_at = excluded.updated_at
          `;
          const settlesOpenTurns = yield* trackAcceptedTurn({
            ...input,
            eventType: event.eventType,
            threadId: event.threadId,
            turnId: event.turnId,
          });
          const cursor = yield* compactSettledConsumerCursor(
            input.consumerName,
            input.updatedAt,
          );
          if (cursor === null) return false;
          if (
            !settlesOpenTurns &&
            cursor - lastRetentionScanSequence <
              PROVIDER_RUNTIME_EVENT_RETENTION_SCAN_INTERVAL
          ) {
            return true;
          }
          retentionScanSequence = cursor;
          yield* pruneAcceptedHistory(cursor);
          return true;
        }),
      )
      .pipe(
        // Only a committed scan may move the hint forward; a rolled back
        // transaction leaves it where it was so the next advance rescans.
        Effect.tap(() =>
          Effect.sync(() => {
            if (retentionScanSequence !== null) {
              lastRetentionScanSequence = Math.max(
                lastRetentionScanSequence,
                retentionScanSequence,
              );
            }
          }),
        ),
        Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.advanceConsumerCursor")),
      );
  };

  const recordConsumerFailure: ProviderRuntimeEventRepositoryShape["recordConsumerFailure"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<{
            readonly status: "accepted" | "retry" | "dead_letter";
            readonly attemptCount: number;
            readonly firstFailedAt: string | null;
          }>`
            INSERT INTO provider_runtime_event_deliveries (
              consumer_name, event_sequence, status, attempt_count,
              first_failed_at, last_failed_at, last_error, updated_at
            ) VALUES (
              ${input.consumerName}, ${input.eventSequence}, 'retry', 1,
              ${input.failedAt}, ${input.failedAt}, ${input.error}, ${input.failedAt}
            )
            ON CONFLICT (consumer_name, event_sequence) DO UPDATE SET
              status = CASE
                WHEN provider_runtime_event_deliveries.status IN ('accepted', 'dead_letter')
                  THEN provider_runtime_event_deliveries.status
                ELSE 'retry'
              END,
              attempt_count = provider_runtime_event_deliveries.attempt_count + 1,
              first_failed_at = COALESCE(
                provider_runtime_event_deliveries.first_failed_at,
                excluded.first_failed_at
              ),
              last_failed_at = excluded.last_failed_at,
              last_error = excluded.last_error,
              updated_at = excluded.updated_at
            RETURNING status, attempt_count AS "attemptCount", first_failed_at AS "firstFailedAt"
          `;
          const row = rows[0];
          if (!row || row.firstFailedAt === null) {
            return {
              status: "retry" as const,
              attemptCount: row?.attemptCount ?? 1,
              firstFailedAt: input.failedAt,
            };
          }
          if (row.status === "accepted") {
            return {
              status: "accepted" as const,
              attemptCount: row.attemptCount,
              firstFailedAt: row.firstFailedAt,
            };
          }
          const shouldDeadLetter =
            row.status === "dead_letter" ||
            (row.attemptCount >= PROVIDER_RUNTIME_EVENT_FAILURE_ATTEMPT_LIMIT &&
              Date.parse(input.failedAt) - Date.parse(row.firstFailedAt) >=
                PROVIDER_RUNTIME_EVENT_FAILURE_MIN_AGE_MS);
          if (shouldDeadLetter) {
            yield* sql`
              UPDATE provider_runtime_event_deliveries
              SET status = 'dead_letter', updated_at = ${input.failedAt}
              WHERE consumer_name = ${input.consumerName}
                AND event_sequence = ${input.eventSequence}
            `;
            yield* compactSettledConsumerCursor(input.consumerName, input.failedAt);
          }
          return {
            status: shouldDeadLetter ? ("dead_letter" as const) : ("retry" as const),
            attemptCount: row.attemptCount,
            firstFailedAt: row.firstFailedAt,
          };
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.recordConsumerFailure")));

  const deadLetterConsumerEvent: ProviderRuntimeEventRepositoryShape["deadLetterConsumerEvent"] = (
    input,
  ) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const eventRows = yield* sql<{ readonly sequence: number }>`
            SELECT sequence FROM provider_runtime_events WHERE sequence = ${input.eventSequence}
          `;
          if (eventRows.length === 0) return false;
          yield* sql`
            INSERT INTO provider_runtime_event_deliveries (
              consumer_name, event_sequence, status, attempt_count,
              first_failed_at, last_failed_at, last_error, updated_at
            ) VALUES (
              ${input.consumerName}, ${input.eventSequence}, 'dead_letter', 1,
              ${input.failedAt}, ${input.failedAt}, ${input.error}, ${input.failedAt}
            )
            ON CONFLICT (consumer_name, event_sequence) DO UPDATE SET
              status = CASE
                WHEN provider_runtime_event_deliveries.status = 'accepted' THEN 'accepted'
                ELSE 'dead_letter'
              END,
              last_failed_at = excluded.last_failed_at,
              last_error = excluded.last_error,
              updated_at = excluded.updated_at
          `;
          yield* compactSettledConsumerCursor(input.consumerName, input.failedAt);
          return true;
        }),
      )
      .pipe(Effect.mapError(toPersistenceSqlError("ProviderRuntimeEvent.deadLetterConsumerEvent")));

  return {
    append,
    getHighWaterSequence,
    readAfter,
    readPending,
    getThreadCoverage,
    readThreadEvents,
    readAcceptedOpenTurnEvents,
    pruneSettledOpenTurns,
    getConsumerCursor,
    hasPendingEventsForThreads,
    advanceConsumerCursor,
    recordConsumerFailure,
    deadLetterConsumerEvent,
  } satisfies ProviderRuntimeEventRepositoryShape;
});

export const ProviderRuntimeEventRepositoryLive = Layer.effect(
  ProviderRuntimeEventRepository,
  make,
);
