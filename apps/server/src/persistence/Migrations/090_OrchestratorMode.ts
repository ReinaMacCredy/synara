import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { columnExists } from "./schemaHelpers.ts";

const MIGRATION_ID = 90;

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const migratedAt = new Date().toISOString();

  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (!(yield* columnExists(sql, "projection_threads", "working_directory"))) {
        yield* sql`
          ALTER TABLE projection_threads
          ADD COLUMN working_directory TEXT
        `;
      }

      yield* sql`
        CREATE TABLE IF NOT EXISTS orchestrator_migration_purge_log (
          migration_id INTEGER NOT NULL,
          table_name TEXT NOT NULL,
          removed_count INTEGER NOT NULL CHECK (removed_count >= 0),
          migrated_at TEXT NOT NULL,
          PRIMARY KEY (migration_id, table_name)
        )
      `;

      yield* sql`DROP TABLE IF EXISTS temp.migration_090_studio_projects`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_090_studio_threads`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_090_studio_events`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_090_studio_commands`;
      yield* sql`DROP TABLE IF EXISTS temp.migration_090_external_operations`;

      yield* sql`
        CREATE TEMP TABLE migration_090_studio_projects (
          project_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT INTO migration_090_studio_projects (project_id)
        SELECT project_id
        FROM projection_projects
        WHERE kind = 'studio'
      `;
      yield* sql`
        CREATE TEMP TABLE migration_090_studio_threads (
          thread_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT INTO migration_090_studio_threads (thread_id)
        SELECT thread_id
        FROM projection_threads
        WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
      `;
      yield* sql`
        CREATE TEMP TABLE migration_090_studio_events (
          sequence INTEGER PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT INTO migration_090_studio_events (sequence)
        SELECT sequence
        FROM orchestration_events
        WHERE (
          aggregate_kind = 'project'
          AND stream_id IN (SELECT project_id FROM migration_090_studio_projects)
        ) OR (
          aggregate_kind = 'thread'
          AND stream_id IN (SELECT thread_id FROM migration_090_studio_threads)
        )
      `;
      yield* sql`
        CREATE TEMP TABLE migration_090_studio_commands (
          command_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT OR IGNORE INTO migration_090_studio_commands (command_id)
        SELECT command_id
        FROM orchestration_events
        WHERE sequence IN (SELECT sequence FROM migration_090_studio_events)
          AND command_id IS NOT NULL
      `;
      yield* sql`
        CREATE TEMP TABLE migration_090_external_operations (
          operation_id TEXT PRIMARY KEY
        )
      `;
      yield* sql`
        INSERT INTO migration_090_external_operations (operation_id)
        SELECT operation_id
        FROM external_mcp_tasks
        WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
           OR thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
      `;

      const purge = (
        tableName: string,
        statement: Effect.Effect<unknown, SqlError>,
      ): Effect.Effect<void, SqlError> =>
        Effect.gen(function* () {
          yield* statement;
          const rows = yield* sql<{ readonly count: number }>`SELECT changes() AS count`;
          const removedCount = rows[0]?.count ?? 0;
          yield* sql`
            INSERT INTO orchestrator_migration_purge_log (
              migration_id, table_name, removed_count, migrated_at
            ) VALUES (
              ${MIGRATION_ID}, ${tableName}, ${removedCount}, ${migratedAt}
            )
            ON CONFLICT (migration_id, table_name) DO NOTHING
          `;
          yield* Effect.logInfo("Migration 090 purged Studio-owned rows", {
            tableName,
            removedCount,
          });
        });

      yield* purge(
        "provider_delivery_reconciliations",
        sql`
          DELETE FROM provider_delivery_reconciliations
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR event_sequence IN (SELECT sequence FROM migration_090_studio_events)
        `,
      );
      yield* purge(
        "orchestration_event_deliveries",
        sql`
          DELETE FROM orchestration_event_deliveries
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR event_sequence IN (SELECT sequence FROM migration_090_studio_events)
        `,
      );
      yield* purge(
        "queued_turn_promotions",
        sql`
          DELETE FROM queued_turn_promotions
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR queued_event_sequence IN (SELECT sequence FROM migration_090_studio_events)
        `,
      );
      yield* purge(
        "managed_attachment_blobs",
        sql`
          DELETE FROM managed_attachment_blobs
          WHERE owner_thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "projection_pending_interactions",
        sql`
          DELETE FROM projection_pending_interactions
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "projection_thread_proposed_plans",
        sql`
          DELETE FROM projection_thread_proposed_plans
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR implementation_thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "projection_turns",
        sql`
          DELETE FROM projection_turns
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR source_proposed_plan_thread_id IN (
               SELECT thread_id FROM migration_090_studio_threads
             )
        `,
      );
      yield* purge(
        "projection_thread_sessions",
        sql`
          DELETE FROM projection_thread_sessions
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "projection_thread_activities",
        sql`
          DELETE FROM projection_thread_activities
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "projection_thread_messages",
        sql`
          DELETE FROM projection_thread_messages
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "checkpoint_diff_blobs",
        sql`
          DELETE FROM checkpoint_diff_blobs
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "provider_session_runtime",
        sql`
          DELETE FROM provider_session_runtime
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "provider_runtime_open_turns",
        sql`
          DELETE FROM provider_runtime_open_turns
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "provider_runtime_events",
        sql`
          DELETE FROM provider_runtime_events
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "git_handoff_operations",
        sql`
          DELETE FROM git_handoff_operations
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "agent_gateway_operations",
        sql`
          DELETE FROM agent_gateway_operations
          WHERE caller_thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "operational_diagnostics",
        sql`
          DELETE FROM operational_diagnostics
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "profile_stats_deleted_prompts",
        sql`
          DELETE FROM profile_stats_deleted_prompts
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );
      yield* purge(
        "profile_stats_deleted_skills",
        sql`
          DELETE FROM profile_stats_deleted_skills
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "profile_stats_deleted_tokens",
        sql`
          DELETE FROM profile_stats_deleted_tokens
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "profile_stats_deleted_turns",
        sql`
          DELETE FROM profile_stats_deleted_turns
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "profile_stats_deleted_threads",
        sql`
          DELETE FROM profile_stats_deleted_threads
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
             OR project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );
      yield* purge(
        "automation_memory",
        sql`
          DELETE FROM automation_memory
          WHERE automation_id IN (
            SELECT automation_id FROM automation_definitions
            WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
          )
        `,
      );
      yield* purge(
        "automation_runs",
        sql`
          DELETE FROM automation_runs
          WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
             OR thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "automation_definitions",
        sql`
          DELETE FROM automation_definitions
          WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );
      yield* purge(
        "external_mcp_audit_log",
        sql`
          DELETE FROM external_mcp_audit_log
          WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );
      yield* purge(
        "external_mcp_integration_projects",
        sql`
          DELETE FROM external_mcp_integration_projects
          WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );
      yield* purge(
        "external_mcp_tasks",
        sql`
          DELETE FROM external_mcp_tasks
          WHERE operation_id IN (SELECT operation_id FROM migration_090_external_operations)
        `,
      );
      yield* purge(
        "external_mcp_operations",
        sql`
          DELETE FROM external_mcp_operations
          WHERE operation_id IN (SELECT operation_id FROM migration_090_external_operations)
        `,
      );
      yield* purge(
        "project_pull_request_pins",
        sql`
          DELETE FROM project_pull_request_pins
          WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );
      yield* purge(
        "orchestration_command_receipts",
        sql`
          DELETE FROM orchestration_command_receipts
          WHERE command_id IN (SELECT command_id FROM migration_090_studio_commands)
             OR (
               aggregate_kind = 'project'
               AND aggregate_id IN (SELECT project_id FROM migration_090_studio_projects)
             )
             OR (
               aggregate_kind = 'thread'
               AND aggregate_id IN (SELECT thread_id FROM migration_090_studio_threads)
             )
        `,
      );
      yield* purge(
        "orchestration_events",
        sql`
          DELETE FROM orchestration_events
          WHERE sequence IN (SELECT sequence FROM migration_090_studio_events)
        `,
      );
      yield* purge(
        "projection_threads",
        sql`
          DELETE FROM projection_threads
          WHERE thread_id IN (SELECT thread_id FROM migration_090_studio_threads)
        `,
      );
      yield* purge(
        "projection_projects",
        sql`
          DELETE FROM projection_projects
          WHERE project_id IN (SELECT project_id FROM migration_090_studio_projects)
        `,
      );

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_task_processes (
          process_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
          owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'orchestrator')),
          owner_root_thread_id TEXT,
          state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'completed', 'archived')),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
          high_water_cursor TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (owner_kind = 'user' AND owner_root_thread_id IS NULL) OR
            (owner_kind = 'orchestrator' AND owner_root_thread_id IS NOT NULL)
          ),
          UNIQUE (process_id, project_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_processes_project_state
        ON projection_task_processes(project_id, state, updated_at DESC, process_id)
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_task_processes_active_root_owner
        ON projection_task_processes(owner_root_thread_id)
        WHERE owner_kind = 'orchestrator' AND state IN ('active', 'paused')
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_project_tasks (
          task_id TEXT PRIMARY KEY,
          process_id TEXT NOT NULL,
          parent_task_id TEXT,
          title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 512),
          description TEXT CHECK (description IS NULL OR length(description) <= 32768),
          acceptance_criteria_json TEXT NOT NULL CHECK (json_valid(acceptance_criteria_json)),
          priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
          risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
          lifecycle TEXT NOT NULL CHECK (
            lifecycle IN ('planned', 'in_progress', 'review', 'done', 'paused', 'failed', 'cancelled')
          ),
          order_key TEXT NOT NULL CHECK (length(order_key) BETWEEN 1 AND 256),
          created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
          readiness TEXT NOT NULL CHECK (readiness IN ('ready', 'blocked')),
          execution_health TEXT NOT NULL CHECK (
            execution_health IN ('idle', 'running', 'waiting', 'stalled')
          ),
          evidence_state TEXT NOT NULL CHECK (evidence_state IN ('current', 'potentially_stale')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (process_id, task_id),
          FOREIGN KEY (process_id) REFERENCES projection_task_processes(process_id) ON DELETE CASCADE,
          FOREIGN KEY (process_id, parent_task_id)
            REFERENCES projection_project_tasks(process_id, task_id) DEFERRABLE INITIALLY DEFERRED,
          CHECK (parent_task_id IS NULL OR parent_task_id <> task_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_project_tasks_process_order
        ON projection_project_tasks(process_id, order_key, task_id)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_project_tasks_process_lifecycle
        ON projection_project_tasks(process_id, lifecycle, readiness, execution_health)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_task_dependencies (
          edge_id TEXT PRIMARY KEY,
          process_id TEXT NOT NULL,
          dependent_task_id TEXT NOT NULL,
          prerequisite_task_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('active', 'waived')),
          created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
          created_at TEXT NOT NULL,
          waived_by_json TEXT CHECK (waived_by_json IS NULL OR json_valid(waived_by_json)),
          waived_at TEXT,
          waiver_reason TEXT CHECK (waiver_reason IS NULL OR length(waiver_reason) <= 512),
          UNIQUE (process_id, dependent_task_id, prerequisite_task_id),
          FOREIGN KEY (process_id) REFERENCES projection_task_processes(process_id) ON DELETE CASCADE,
          FOREIGN KEY (process_id, dependent_task_id)
            REFERENCES projection_project_tasks(process_id, task_id) ON DELETE CASCADE,
          FOREIGN KEY (process_id, prerequisite_task_id)
            REFERENCES projection_project_tasks(process_id, task_id) ON DELETE CASCADE,
          CHECK (dependent_task_id <> prerequisite_task_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_dependencies_dependent
        ON projection_task_dependencies(process_id, dependent_task_id, state)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_dependencies_prerequisite
        ON projection_task_dependencies(process_id, prerequisite_task_id, state)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_task_bindings (
          binding_id TEXT PRIMARY KEY,
          process_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          assignment_id TEXT,
          role TEXT NOT NULL CHECK (role IN ('owner', 'contributor', 'reviewer', 'verifier', 'observer')),
          active_from TEXT NOT NULL,
          retired_at TEXT,
          UNIQUE (process_id, binding_id),
          FOREIGN KEY (process_id, task_id)
            REFERENCES projection_project_tasks(process_id, task_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_bindings_task_active
        ON projection_task_bindings(process_id, task_id, retired_at, role)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_bindings_thread_active
        ON projection_task_bindings(thread_id, retired_at, process_id, task_id)
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_task_bindings_active_owner
        ON projection_task_bindings(process_id, task_id)
        WHERE role = 'owner' AND retired_at IS NULL
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_task_bindings_active_owner_thread
        ON projection_task_bindings(thread_id)
        WHERE role = 'owner' AND retired_at IS NULL
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_task_progress (
          progress_id TEXT PRIMARY KEY,
          process_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          assignment_id TEXT,
          thread_id TEXT,
          actor_json TEXT NOT NULL CHECK (json_valid(actor_json)),
          kind TEXT NOT NULL CHECK (
            kind IN ('progress', 'waiting', 'blocker', 'failure', 'completion_evidence')
          ),
          summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 32768),
          evidence_refs_json TEXT NOT NULL CHECK (json_valid(evidence_refs_json)),
          created_at TEXT NOT NULL,
          FOREIGN KEY (process_id, task_id)
            REFERENCES projection_project_tasks(process_id, task_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_progress_task_created
        ON projection_task_progress(process_id, task_id, created_at DESC, progress_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_task_blockers (
          blocker_id TEXT PRIMARY KEY,
          process_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('external', 'user_input', 'permission', 'resource', 'writer_claim')),
          summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 32768),
          created_by_json TEXT NOT NULL CHECK (json_valid(created_by_json)),
          created_at TEXT NOT NULL,
          resolved_by_json TEXT CHECK (resolved_by_json IS NULL OR json_valid(resolved_by_json)),
          resolved_at TEXT,
          resolution TEXT CHECK (resolution IS NULL OR length(resolution) <= 32768),
          FOREIGN KEY (process_id, task_id)
            REFERENCES projection_project_tasks(process_id, task_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_task_blockers_task_open
        ON projection_task_blockers(process_id, task_id, resolved_at)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_roots (
          root_thread_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
          state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
          active_process_id TEXT,
          resource_policy_version INTEGER NOT NULL CHECK (resource_policy_version > 0),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          high_water_cursor TEXT NOT NULL,
          created_at TEXT NOT NULL,
          archived_at TEXT,
          FOREIGN KEY (active_process_id) REFERENCES projection_task_processes(process_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_roots_project_state
        ON projection_orchestrator_roots(project_id, state, created_at, root_thread_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_ownership_edges (
          root_thread_id TEXT NOT NULL,
          parent_thread_id TEXT NOT NULL,
          child_thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
          contract_version INTEGER NOT NULL CHECK (contract_version > 0),
          source_thread_id TEXT NOT NULL,
          source_turn_id TEXT,
          source_operation_id TEXT,
          active_from TEXT NOT NULL,
          retired_at TEXT,
          decision_reason_json TEXT NOT NULL CHECK (json_valid(decision_reason_json)),
          PRIMARY KEY (root_thread_id, child_thread_id, contract_version),
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE,
          CHECK (parent_thread_id <> child_thread_id)
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_orchestrator_ownership_active_child
        ON projection_orchestrator_ownership_edges(root_thread_id, child_thread_id)
        WHERE retired_at IS NULL
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_ownership_parent
        ON projection_orchestrator_ownership_edges(root_thread_id, parent_thread_id, retired_at)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_links (
          link_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          source_thread_id TEXT NOT NULL,
          target_thread_id TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('bidirectional', 'source_to_target', 'target_to_source')),
          task_id TEXT,
          run_id TEXT,
          capabilities_json TEXT NOT NULL CHECK (json_valid(capabilities_json)),
          requested_by_json TEXT NOT NULL CHECK (json_valid(requested_by_json)),
          granted_by_json TEXT CHECK (granted_by_json IS NULL OR json_valid(granted_by_json)),
          reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1024),
          state TEXT NOT NULL CHECK (state IN ('requested', 'granted', 'rejected', 'revoked', 'expired')),
          created_at TEXT NOT NULL,
          expires_at TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE,
          CHECK (source_thread_id <> target_thread_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_links_reachable
        ON projection_orchestrator_links(root_thread_id, source_thread_id, target_thread_id, state, expires_at)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_assignments (
          assignment_id TEXT NOT NULL,
          contract_version INTEGER NOT NULL CHECK (contract_version > 0),
          root_thread_id TEXT NOT NULL,
          process_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          owner_thread_id TEXT NOT NULL,
          assignee_thread_id TEXT NOT NULL,
          contract_json TEXT NOT NULL CHECK (json_valid(contract_json)),
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (assignment_id, contract_version),
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE,
          FOREIGN KEY (process_id, task_id)
            REFERENCES projection_project_tasks(process_id, task_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_orchestrator_assignment_latest
        ON projection_orchestrator_assignments(assignment_id, contract_version)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_assignments_root_state
        ON projection_orchestrator_assignments(root_thread_id, state, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_runs (
          run_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('collaboration', 'council')),
          state TEXT NOT NULL,
          disposition TEXT,
          brief_hash TEXT,
          participants_json TEXT NOT NULL CHECK (json_valid(participants_json)),
          decision_packet_artifact_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_runs_root_updated
        ON projection_orchestrator_runs(root_thread_id, updated_at DESC, run_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_messages (
          message_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          sender_thread_id TEXT NOT NULL,
          target_thread_id TEXT NOT NULL,
          assignment_id TEXT,
          run_id TEXT,
          correlation_id TEXT,
          reply_to_message_id TEXT,
          hop_count INTEGER NOT NULL CHECK (hop_count BETWEEN 0 AND 32),
          expires_at TEXT NOT NULL,
          body TEXT NOT NULL CHECK (length(CAST(body AS BLOB)) BETWEEN 1 AND 65536),
          artifact_refs_json TEXT NOT NULL CHECK (json_valid(artifact_refs_json)),
          delivery_state TEXT NOT NULL,
          delivery_attempt_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
          CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_messages_target_state
          ON projection_orchestrator_messages(root_thread_id, target_thread_id, delivery_state, created_at, message_id)
        `;
      yield* sql`
          CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_messages_root_state
          ON projection_orchestrator_messages(root_thread_id, delivery_state, created_at, message_id)
        `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_monitors (
          monitor_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          target_thread_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('notify', 'heartbeat', 'schedule', 'wait')),
          condition TEXT NOT NULL CHECK (length(CAST(condition AS BLOB)) BETWEEN 1 AND 65536),
          cadence_ms INTEGER CHECK (cadence_ms IS NULL OR cadence_ms > 0),
          next_wake_at TEXT,
          max_runs INTEGER NOT NULL CHECK (max_runs > 0),
          run_count INTEGER NOT NULL CHECK (run_count >= 0 AND run_count <= max_runs),
          expires_at TEXT NOT NULL,
          owner_thread_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('active', 'fired', 'cancelled', 'expired')),
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_monitors_due
        ON projection_orchestrator_monitors(state, next_wake_at, expires_at, monitor_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_writer_claims (
          claim_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          workspace_root TEXT NOT NULL,
          normalized_path_prefix TEXT NOT NULL,
          assignment_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('read', 'write')),
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          released_at TEXT,
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_projection_orchestrator_writer_claims_active
        ON projection_orchestrator_writer_claims(workspace_root, normalized_path_prefix, mode, released_at, expires_at)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_provider_capabilities (
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          capability_json TEXT NOT NULL CHECK (json_valid(capability_json)),
          observed_at TEXT NOT NULL,
          PRIMARY KEY (provider, model)
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_orchestrator_capacity (
          root_thread_id TEXT PRIMARY KEY,
          capacity_json TEXT NOT NULL CHECK (json_valid(capacity_json)),
          observed_at TEXT NOT NULL,
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS orchestrator_artifacts (
          artifact_id TEXT PRIMARY KEY,
          root_thread_id TEXT NOT NULL,
          run_id TEXT,
          round INTEGER CHECK (round IS NULL OR round > 0),
          kind TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          content TEXT NOT NULL CHECK (length(CAST(content AS BLOB)) BETWEEN 1 AND 65536),
          producer_thread_id TEXT NOT NULL,
          visibility TEXT NOT NULL CHECK (
            visibility IN ('private', 'sealed', 'round_released', 'root_released', 'public')
          ),
          source_refs_json TEXT NOT NULL CHECK (json_valid(source_refs_json)),
          supersedes_artifact_id TEXT,
          schema_version INTEGER NOT NULL CHECK (schema_version > 0),
          created_at TEXT NOT NULL,
          FOREIGN KEY (root_thread_id) REFERENCES projection_orchestrator_roots(root_thread_id) ON DELETE CASCADE,
          FOREIGN KEY (supersedes_artifact_id) REFERENCES orchestrator_artifacts(artifact_id)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_orchestrator_artifacts_root_run_created
        ON orchestrator_artifacts(root_thread_id, run_id, created_at, artifact_id)
      `;
      yield* sql`
        CREATE TRIGGER IF NOT EXISTS trg_orchestrator_artifacts_immutable
        BEFORE UPDATE OF
          root_thread_id, run_id, round, kind, content_hash, content,
          producer_thread_id, source_refs_json, supersedes_artifact_id,
          schema_version, created_at
        ON orchestrator_artifacts
        BEGIN
          SELECT RAISE(ABORT, 'orchestrator artifact content is immutable');
        END
      `;
      yield* sql`
        CREATE TRIGGER IF NOT EXISTS trg_orchestrator_artifacts_no_delete
        BEFORE DELETE ON orchestrator_artifacts
        BEGIN
          SELECT RAISE(ABORT, 'orchestrator artifacts are immutable');
        END
      `;
      yield* sql`
        CREATE TRIGGER IF NOT EXISTS trg_projection_projects_no_studio_insert
        BEFORE INSERT ON projection_projects
        WHEN NEW.kind = 'studio'
        BEGIN
          SELECT RAISE(ABORT, 'Studio project kind was removed');
        END
      `;
      yield* sql`
        CREATE TRIGGER IF NOT EXISTS trg_projection_projects_no_studio_update
        BEFORE UPDATE OF kind ON projection_projects
        WHEN NEW.kind = 'studio'
        BEGIN
          SELECT RAISE(ABORT, 'Studio project kind was removed');
        END
      `;

      yield* sql`DROP TABLE migration_090_external_operations`;
      yield* sql`DROP TABLE migration_090_studio_commands`;
      yield* sql`DROP TABLE migration_090_studio_events`;
      yield* sql`DROP TABLE migration_090_studio_threads`;
      yield* sql`DROP TABLE migration_090_studio_projects`;
    }),
  );
});
