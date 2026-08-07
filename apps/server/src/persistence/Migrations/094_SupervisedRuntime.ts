import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_runtime_state (
          singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
          daemon_epoch INTEGER NOT NULL CHECK (daemon_epoch >= 1),
          status TEXT NOT NULL CHECK (status IN ('starting', 'healthy', 'degraded', 'recovering', 'stopped')),
          snapshot_sequence INTEGER NOT NULL CHECK (snapshot_sequence >= 0),
          health_json TEXT NOT NULL CHECK (json_valid(health_json)),
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`
        INSERT INTO supervised_runtime_state (
          singleton_id, daemon_epoch, status, snapshot_sequence, health_json, updated_at
        ) VALUES (
          1,
          1,
          'stopped',
          0,
          '{"daemonEpoch":1,"status":"stopped","journalLag":0,"deliveryQueueDepth":0,"deadLetterCount":0,"unhealthyPluginCount":0,"lastRecoveryAt":null,"updatedAt":"1970-01-01T00:00:00.000Z"}',
          '1970-01-01T00:00:00.000Z'
        )
        ON CONFLICT (singleton_id) DO NOTHING
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_rooms (
          room_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          lead_seat_id TEXT,
          status TEXT NOT NULL,
          graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_rooms_project_status
        ON projection_supervised_rooms(project_id, status, updated_at DESC, room_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_tasks (
          task_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          lifecycle TEXT NOT NULL,
          graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_tasks_room_lifecycle
        ON projection_supervised_tasks(room_id, lifecycle, updated_at DESC, task_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_task_nodes (
          task_node_id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          room_id TEXT NOT NULL,
          active_revision_id TEXT NOT NULL,
          lifecycle TEXT NOT NULL,
          graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (task_id) REFERENCES projection_supervised_tasks(task_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_task_nodes_task_state
        ON projection_supervised_task_nodes(task_id, lifecycle, graph_revision, task_node_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_task_node_revisions (
          task_node_revision_id TEXT PRIMARY KEY,
          task_node_id TEXT NOT NULL,
          graph_revision INTEGER NOT NULL CHECK (graph_revision >= 0),
          created_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          UNIQUE (task_node_id, graph_revision, task_node_revision_id),
          FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_runs (
          run_id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          task_node_id TEXT,
          status TEXT NOT NULL,
          daemon_epoch INTEGER NOT NULL CHECK (daemon_epoch >= 1),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          last_progress_at TEXT,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
          FOREIGN KEY (task_id) REFERENCES projection_supervised_tasks(task_id) ON DELETE CASCADE,
          FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE SET NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_runs_daemon_queue
        ON projection_supervised_runs(status, daemon_epoch, updated_at, run_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_run_policies (
          policy_id TEXT PRIMARY KEY,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_context_workspaces (
          workspace_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          room_id TEXT,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          high_water_sequence INTEGER NOT NULL CHECK (high_water_sequence >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (project_id) REFERENCES projection_projects(project_id) ON DELETE CASCADE,
          FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_context_workspaces_project_room
        ON projection_context_workspaces(project_id, room_id, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_context_records (
          record_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          content_revision INTEGER NOT NULL CHECK (content_revision >= 1),
          blob_hash TEXT,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (workspace_id) REFERENCES projection_context_workspaces(workspace_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_context_records_workspace_status
        ON projection_context_records(workspace_id, status, kind, updated_at DESC, record_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_blob_metadata (
          content_hash TEXT PRIMARY KEY,
          media_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
          relative_path TEXT NOT NULL,
          reference_count INTEGER NOT NULL CHECK (reference_count >= 0),
          created_at TEXT NOT NULL,
          last_referenced_at TEXT NOT NULL
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_harness_patches (
          patch_id TEXT PRIMARY KEY,
          scope_kind TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          status TEXT NOT NULL,
          version INTEGER NOT NULL CHECK (version >= 1),
          base_policy_hash TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_harness_patches_scope_status
        ON projection_harness_patches(scope_kind, scope_id, status, updated_at DESC)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_retained_specialists (
          specialist_id TEXT PRIMARY KEY,
          profile_preset_id TEXT NOT NULL,
          concern TEXT NOT NULL,
          status TEXT NOT NULL,
          latest_snapshot_id TEXT,
          expires_at TEXT NOT NULL,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_retained_specialists_status_expiry
        ON projection_retained_specialists(status, expires_at, specialist_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_specialist_snapshots (
          specialist_snapshot_id TEXT PRIMARY KEY,
          specialist_id TEXT NOT NULL,
          profile_content_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (specialist_id) REFERENCES projection_retained_specialists(specialist_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_kernel_sessions (
          kernel_session_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          language TEXT NOT NULL CHECK (language IN ('javascript', 'python')),
          status TEXT NOT NULL,
          process_id INTEGER,
          last_used_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_kernel_executions (
          kernel_execution_id TEXT PRIMARY KEY,
          kernel_session_id TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (kernel_session_id) REFERENCES projection_kernel_sessions(kernel_session_id) ON DELETE CASCADE
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_event_schemas (
          schema_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          version TEXT NOT NULL,
          compatibility TEXT NOT NULL CHECK (compatibility IN ('backward', 'forward', 'breaking')),
          status TEXT NOT NULL CHECK (status IN ('active', 'deprecated', 'revoked')),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          UNIQUE (event_type, version)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_event_schemas_catalog
        ON supervised_event_schemas(status, event_type, version)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_control_plane_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          schema_id TEXT NOT NULL,
          schema_version TEXT NOT NULL,
          event_type TEXT NOT NULL,
          scope_kind TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          event_time TEXT NOT NULL,
          recorded_at TEXT NOT NULL,
          revision INTEGER,
          causation_event_id TEXT,
          correlation_id TEXT,
          event_json TEXT NOT NULL CHECK (json_valid(event_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_control_plane_events_processing
        ON supervised_control_plane_events(sequence, event_time, event_type)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_control_plane_events_subject_revision
        ON supervised_control_plane_events(subject_id, revision, event_time, sequence)
      `;
      yield* sql`
        CREATE TRIGGER IF NOT EXISTS supervised_control_plane_events_no_update
        BEFORE UPDATE ON supervised_control_plane_events
        BEGIN
          SELECT RAISE(ABORT, 'supervised_control_plane_events are immutable');
        END
      `;
      yield* sql`
        CREATE TRIGGER IF NOT EXISTS supervised_control_plane_events_no_delete
        BEFORE DELETE ON supervised_control_plane_events
        BEGIN
          SELECT RAISE(ABORT, 'supervised_control_plane_events are immutable');
        END
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_metric_samples (
          metric_sample_id TEXT PRIMARY KEY,
          metric_name TEXT NOT NULL,
          scope_kind TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          event_time TEXT NOT NULL,
          revision INTEGER,
          aggregation_receipt_hash TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_metric_samples_window
        ON projection_supervised_metric_samples(metric_name, subject_id, revision, event_time)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_aggregation_receipts (
          receipt_hash TEXT PRIMARY KEY,
          subscription_id TEXT,
          window_start TEXT NOT NULL,
          window_end TEXT NOT NULL,
          source_event_ids_json TEXT NOT NULL CHECK (json_valid(source_event_ids_json)),
          source_metric_ids_json TEXT NOT NULL CHECK (json_valid(source_metric_ids_json)),
          computed_at TEXT NOT NULL
        )
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_subscriptions (
          subscription_id TEXT PRIMARY KEY,
          owner_lead_seat_id TEXT,
          concern TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('enabled', 'paused', 'revoked')),
          armed INTEGER NOT NULL CHECK (armed IN (0, 1)),
          replay_policy TEXT NOT NULL CHECK (replay_policy IN ('disabled', 'observe_only', 'idempotent_actions')),
          next_eligible_at TEXT,
          last_triggered_at TEXT,
          last_reset_at TEXT,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_subscriptions_evaluation
        ON projection_supervised_subscriptions(state, armed, next_eligible_at, subscription_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_delivery_cursors (
          subscription_id TEXT PRIMARY KEY,
          last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
          last_event_time TEXT,
          watermark TEXT,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (subscription_id) REFERENCES projection_supervised_subscriptions(subscription_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_subscription_groups (
          subscription_id TEXT NOT NULL,
          group_key TEXT NOT NULL,
          armed INTEGER NOT NULL CHECK (armed IN (0, 1)),
          next_eligible_at TEXT,
          pending_since TEXT,
          active_signal_id TEXT,
          sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
          updated_at TEXT NOT NULL,
          state_json TEXT NOT NULL CHECK (json_valid(state_json)),
          PRIMARY KEY (subscription_id, group_key),
          FOREIGN KEY (subscription_id) REFERENCES projection_supervised_subscriptions(subscription_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS projection_supervised_signals (
          signal_id TEXT PRIMARY KEY,
          subscription_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          subject_id TEXT NOT NULL,
          group_key TEXT NOT NULL,
          state TEXT NOT NULL,
          triggered_at TEXT NOT NULL,
          reset_at TEXT,
          revision INTEGER NOT NULL CHECK (revision >= 0),
          aggregation_receipt_hash TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (subscription_id) REFERENCES projection_supervised_subscriptions(subscription_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_supervised_signals_one_open_crossing
        ON projection_supervised_signals(subscription_id, group_key, kind)
        WHERE state IN ('triggered', 'acknowledged')
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_subscription_deliveries (
          delivery_id TEXT PRIMARY KEY,
          subscription_id TEXT NOT NULL,
          signal_id TEXT NOT NULL,
          dedupe_key TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('queued', 'delivering', 'delivered', 'failed', 'dead_lettered')),
          attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
          available_at TEXT NOT NULL,
          lease_owner TEXT,
          lease_expires_at TEXT,
          replay INTEGER NOT NULL CHECK (replay IN (0, 1)),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (subscription_id) REFERENCES projection_supervised_subscriptions(subscription_id) ON DELETE CASCADE,
          FOREIGN KEY (signal_id) REFERENCES projection_supervised_signals(signal_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_deliveries_claim
        ON supervised_subscription_deliveries(status, available_at, lease_expires_at, delivery_id)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_dead_letters (
          dead_letter_id TEXT PRIMARY KEY,
          subscription_id TEXT NOT NULL,
          delivery_id TEXT NOT NULL UNIQUE,
          plugin_id TEXT,
          status TEXT NOT NULL CHECK (status IN ('open', 'redriving', 'resolved', 'discarded')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (subscription_id) REFERENCES projection_supervised_subscriptions(subscription_id) ON DELETE CASCADE,
          FOREIGN KEY (delivery_id) REFERENCES supervised_subscription_deliveries(delivery_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_dead_letters_state
        ON supervised_dead_letters(status, updated_at DESC, dead_letter_id)
      `;

      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_plugin_installations (
          plugin_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('installed', 'enabled', 'disabled', 'unhealthy', 'revoked')),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json))
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_plugin_grants (
          grant_id TEXT PRIMARY KEY,
          plugin_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
          revision INTEGER NOT NULL CHECK (revision >= 0),
          updated_at TEXT NOT NULL,
          entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
          FOREIGN KEY (plugin_id) REFERENCES supervised_plugin_installations(plugin_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_plugin_health (
          plugin_id TEXT PRIMARY KEY,
          consecutive_failures INTEGER NOT NULL CHECK (consecutive_failures >= 0),
          circuit_state TEXT NOT NULL CHECK (circuit_state IN ('closed', 'open', 'half_open')),
          queue_depth INTEGER NOT NULL CHECK (queue_depth >= 0),
          lag_ms INTEGER NOT NULL CHECK (lag_ms >= 0),
          last_success_at TEXT,
          last_failure_at TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (plugin_id) REFERENCES supervised_plugin_installations(plugin_id) ON DELETE CASCADE
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS supervised_runtime_audit (
          audit_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          actor_json TEXT NOT NULL CHECK (json_valid(actor_json)),
          target_kind TEXT NOT NULL,
          target_id TEXT NOT NULL,
          outcome TEXT NOT NULL,
          detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
          occurred_at TEXT NOT NULL
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS idx_supervised_runtime_audit_target
        ON supervised_runtime_audit(target_kind, target_id, audit_sequence DESC)
      `;
    }),
  );
});
