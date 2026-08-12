import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionThreadMessageDbRowSchema,
  projectionThreadMessageFromRow,
} from "../projectionThreadMessageRow.ts";
import {
  GetProjectionThreadMessageInput,
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessageRepositoryShape,
  DeleteProjectionThreadMessagesInput,
  ListProjectionThreadMessagesInput,
  ProjectionThreadMessage,
} from "../Services/ProjectionThreadMessages.ts";

const LatestUserMessageAtRowSchema = Schema.Struct({
  latestUserMessageAt: Schema.String,
});

const makeProjectionThreadMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionThreadMessageRow = SqlSchema.void({
    Request: ProjectionThreadMessage,
    execute: (row) => {
      const nextAttachmentsJson =
        row.attachments !== undefined ? JSON.stringify(row.attachments) : null;
      const nextSkillsJson = row.skills !== undefined ? JSON.stringify(row.skills) : null;
      const nextMentionsJson = row.mentions !== undefined ? JSON.stringify(row.mentions) : null;
      return sql`
        INSERT INTO projection_thread_messages (
          message_id,
          thread_id,
          turn_id,
          role,
          text,
          attachments_json,
          skills_json,
          mentions_json,
          dispatch_mode,
          dispatch_origin,
          is_streaming,
          source,
          sequence,
          created_at,
          updated_at
        )
        VALUES (
          ${row.messageId},
          ${row.threadId},
          ${row.turnId},
          ${row.role},
          ${row.text},
          ${nextAttachmentsJson},
          ${nextSkillsJson},
          ${nextMentionsJson},
          ${row.dispatchMode ?? null},
          ${row.dispatchOrigin ?? null},
          ${row.isStreaming ? 1 : 0},
          ${row.source},
          ${row.sequence ?? null},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (thread_id, message_id)
        DO UPDATE SET
          turn_id = excluded.turn_id,
          role = excluded.role,
          text = excluded.text,
          attachments_json = COALESCE(
            excluded.attachments_json,
            projection_thread_messages.attachments_json
          ),
          skills_json = COALESCE(
            excluded.skills_json,
            projection_thread_messages.skills_json
          ),
          mentions_json = COALESCE(
            excluded.mentions_json,
            projection_thread_messages.mentions_json
          ),
          dispatch_mode = COALESCE(
            excluded.dispatch_mode,
            projection_thread_messages.dispatch_mode
          ),
          dispatch_origin = COALESCE(
            excluded.dispatch_origin,
            projection_thread_messages.dispatch_origin
          ),
          is_streaming = excluded.is_streaming,
          source = excluded.source,
          sequence = COALESCE(projection_thread_messages.sequence, excluded.sequence),
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
      `;
    },
  });

  const listProjectionThreadMessageRows = SqlSchema.findAll({
    Request: ListProjectionThreadMessagesInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message.message_id AS "messageId",
          message.thread_id AS "threadId",
          message.turn_id AS "turnId",
          message.role,
          message.text || COALESCE((
            SELECT GROUP_CONCAT(ordered.delta, '')
            FROM (
              SELECT delta.delta
              FROM projection_thread_message_deltas AS delta
              WHERE delta.thread_id = message.thread_id
                AND delta.message_id = message.message_id
              ORDER BY delta.event_sequence ASC
            ) AS ordered
          ), '') AS text,
          message.attachments_json AS "attachments",
          message.skills_json AS "skills",
          message.mentions_json AS "mentions",
          message.dispatch_mode AS "dispatchMode",
          message.dispatch_origin AS "dispatchOrigin",
          message.is_streaming AS "isStreaming",
          message.source,
          message.sequence,
          message.created_at AS "createdAt",
          message.updated_at AS "updatedAt"
        FROM projection_thread_messages AS message
        WHERE message.thread_id = ${threadId}
        ORDER BY
          CASE WHEN message.sequence IS NULL THEN 0 ELSE 1 END ASC,
          message.sequence ASC,
          message.created_at ASC,
          message.message_id ASC
      `,
  });

  const getLatestProjectionThreadUserMessageAtRow = SqlSchema.findOneOption({
    Request: ListProjectionThreadMessagesInput,
    Result: LatestUserMessageAtRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          created_at AS "latestUserMessageAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
          AND role = 'user'
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
          sequence DESC,
          created_at DESC,
          message_id DESC
        LIMIT 1
      `,
  });

  const getProjectionThreadMessageRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadMessageInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId, messageId }) =>
      sql`
        SELECT
          message.message_id AS "messageId",
          message.thread_id AS "threadId",
          message.turn_id AS "turnId",
          message.role,
          message.text || COALESCE((
            SELECT GROUP_CONCAT(ordered.delta, '')
            FROM (
              SELECT delta.delta
              FROM projection_thread_message_deltas AS delta
              WHERE delta.thread_id = message.thread_id
                AND delta.message_id = message.message_id
              ORDER BY delta.event_sequence ASC
            ) AS ordered
          ), '') AS text,
          message.attachments_json AS "attachments",
          message.skills_json AS "skills",
          message.mentions_json AS "mentions",
          message.dispatch_mode AS "dispatchMode",
          message.dispatch_origin AS "dispatchOrigin",
          message.is_streaming AS "isStreaming",
          message.source,
          message.sequence,
          message.created_at AS "createdAt",
          message.updated_at AS "updatedAt"
        FROM projection_thread_messages AS message
        WHERE message.thread_id = ${threadId}
          AND message.message_id = ${messageId}
        LIMIT 1
      `,
  });

  const deleteProjectionThreadMessageRows = SqlSchema.void({
    Request: DeleteProjectionThreadMessagesInput,
    execute: ({ threadId }) =>
      sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            DELETE FROM projection_thread_message_deltas
            WHERE thread_id = ${threadId}
          `;
          yield* sql`
            DELETE FROM projection_thread_messages
            WHERE thread_id = ${threadId}
          `;
        }),
      ),
  });

  const upsert: ProjectionThreadMessageRepositoryShape["upsert"] = (row) =>
    upsertProjectionThreadMessageRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionThreadMessageRepository.upsert:query")),
    );

  const getByThreadAndMessageId: ProjectionThreadMessageRepositoryShape["getByThreadAndMessageId"] =
    (input) =>
      getProjectionThreadMessageRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionThreadMessageRepository.getByThreadAndMessageId:query"),
        ),
        Effect.map(Option.map(projectionThreadMessageFromRow)),
      );

  const listByThreadId: ProjectionThreadMessageRepositoryShape["listByThreadId"] = (input) =>
    listProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.listByThreadId:query"),
      ),
      Effect.map((rows) => rows.map(projectionThreadMessageFromRow)),
    );

  const getLatestUserMessageAt: ProjectionThreadMessageRepositoryShape["getLatestUserMessageAt"] = (
    input,
  ) =>
    getLatestProjectionThreadUserMessageAtRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.getLatestUserMessageAt:query"),
      ),
      Effect.map(Option.match({ onNone: () => null, onSome: (row) => row.latestUserMessageAt })),
    );

  const deleteByThreadId: ProjectionThreadMessageRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionThreadMessageRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadMessageRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getByThreadAndMessageId,
    listByThreadId,
    getLatestUserMessageAt,
    deleteByThreadId,
  } satisfies ProjectionThreadMessageRepositoryShape;
});

export const ProjectionThreadMessageRepositoryLive = Layer.effect(
  ProjectionThreadMessageRepository,
  makeProjectionThreadMessageRepository,
);
