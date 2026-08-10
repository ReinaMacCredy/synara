import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { tableExists } from "./schemaHelpers.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DROP TABLE IF EXISTS temp.migration_099_legacy_threads`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_099_legacy_processes`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_099_legacy_events`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_099_legacy_commands`;

      yield* sql`
        CREATE TEMP TABLE migration_099_legacy_threads (
          thread_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO migration_099_legacy_threads (thread_id)
        SELECT thread_id
        FROM projection_threads
        WHERE creation_source = 'orchestrator_native'
      `;
      if (yield* tableExists(sql, "projection_orchestrator_roots")) {
        yield* sql`
            INSERT OR IGNORE INTO migration_099_legacy_threads (thread_id)
            SELECT root_thread_id FROM projection_orchestrator_roots
          `;
      }
      if (yield* tableExists(sql, "projection_orchestrator_ownership_edges")) {
        yield* sql`
            INSERT OR IGNORE INTO migration_099_legacy_threads (thread_id)
            SELECT child_thread_id FROM projection_orchestrator_ownership_edges
          `;
      }

      yield* sql`
        CREATE TEMP TABLE migration_099_legacy_processes (
          process_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT INTO migration_099_legacy_processes (process_id)
        SELECT process_id
        FROM projection_task_processes
        WHERE owner_kind = 'orchestrator'
      `;

      yield* sql`
        CREATE TEMP TABLE migration_099_legacy_events (
          sequence INTEGER PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO migration_099_legacy_events (sequence)
        SELECT sequence
        FROM orchestration_events
        WHERE aggregate_kind = 'orchestrator'
           OR (aggregate_kind = 'thread' AND stream_id IN (
             SELECT thread_id FROM migration_099_legacy_threads
           ))
           OR (aggregate_kind = 'task_process' AND stream_id IN (
             SELECT process_id FROM migration_099_legacy_processes
           ))
           OR (
             aggregate_kind = 'supervision'
               AND event_type = 'supervision.peer-bound'
             AND json_extract(payload_json, '$.peer.threadId') IN (
               SELECT thread_id FROM migration_099_legacy_threads
             )
           )
      `;
      yield* sql`
        CREATE TEMP TABLE migration_099_legacy_commands (
          command_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO migration_099_legacy_commands (command_id)
        SELECT command_id
        FROM orchestration_events
        WHERE sequence IN (SELECT sequence FROM migration_099_legacy_events)
          AND command_id IS NOT NULL
      `;

      yield* sql`
        DELETE FROM provider_delivery_reconciliations
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
           OR event_sequence IN (SELECT sequence FROM migration_099_legacy_events)
      `;
      yield* sql`
        DELETE FROM orchestration_event_deliveries
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
           OR event_sequence IN (SELECT sequence FROM migration_099_legacy_events)
      `;
      yield* sql`
        DELETE FROM queued_turn_promotions
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
           OR queued_event_sequence IN (SELECT sequence FROM migration_099_legacy_events)
      `;
      yield* sql`
        DELETE FROM managed_attachment_blobs
        WHERE owner_thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_pending_interactions
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_thread_proposed_plans
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
           OR implementation_thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_turns
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
           OR source_proposed_plan_thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_thread_sessions
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_thread_activities
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_thread_messages
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM checkpoint_diff_blobs
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM provider_session_runtime
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        UPDATE provider_session_runtime
        SET runtime_payload_json = json_remove(runtime_payload_json, '$.orchestratorContext')
        WHERE runtime_payload_json IS NOT NULL
          AND json_valid(runtime_payload_json)
          AND json_type(runtime_payload_json, '$.orchestratorContext') IS NOT NULL
      `;
      yield* sql`
        DELETE FROM provider_runtime_open_turns
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM provider_runtime_events
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM git_handoff_operations
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM agent_gateway_operations
        WHERE caller_thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM operational_diagnostics
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM projection_supervision_peers
        WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;
      yield* sql`
        DELETE FROM orchestration_command_receipts
        WHERE aggregate_kind = 'orchestrator'
           OR command_id IN (SELECT command_id FROM migration_099_legacy_commands)
           OR (aggregate_kind = 'thread' AND aggregate_id IN (
             SELECT thread_id FROM migration_099_legacy_threads
           ))
           OR (aggregate_kind = 'task_process' AND aggregate_id IN (
             SELECT process_id FROM migration_099_legacy_processes
           ))
      `;
      yield* sql`
        DELETE FROM orchestration_events
        WHERE sequence IN (SELECT sequence FROM migration_099_legacy_events)
      `;
      if (yield* tableExists(sql, "projection_orchestrator_roots")) {
        yield* sql`UPDATE projection_orchestrator_roots SET active_process_id = NULL`;
      }
      yield* sql`
          DELETE FROM projection_threads
          WHERE thread_id IN (SELECT thread_id FROM migration_099_legacy_threads)
      `;

      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_child_results`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_messages`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_monitors`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_writer_claims`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_provider_capabilities`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_capacity`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_assignments`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_links`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_ownership_edges`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_runs`;
      yield* sql`DROP TABLE IF EXISTS orchestrator_artifacts`;
      yield* sql`DROP TABLE IF EXISTS projection_orchestrator_roots`;
      yield* sql`DROP TABLE IF EXISTS orchestrator_migration_purge_log`;

      yield* sql`
          DELETE FROM projection_task_processes
          WHERE process_id IN (SELECT process_id FROM migration_099_legacy_processes)
        `;
    }),
  );
});
