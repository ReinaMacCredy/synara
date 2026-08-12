import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";

const THREAD_COUNT = Number(process.argv.find((value) => value.startsWith("--threads="))?.split("=")[1] ?? 100_000);
const SAMPLE_COUNT = Number(process.argv.find((value) => value.startsWith("--samples="))?.split("=")[1] ?? 25);
const tempDirectory = mkdtempSync(join(tmpdir(), "veylen-reconciliation-query-"));
const databasePath = join(tempDirectory, "state.sqlite");
const database = new DatabaseSync(databasePath);

const legacyQuery = `
  SELECT threads.thread_id
  FROM projection_threads AS threads
  LEFT JOIN provider_session_runtime AS runtime ON runtime.thread_id = threads.thread_id
  LEFT JOIN projection_thread_sessions AS sessions ON sessions.thread_id = threads.thread_id
  LEFT JOIN projection_turns AS latest_turn
    ON latest_turn.thread_id = threads.thread_id AND latest_turn.turn_id = threads.latest_turn_id
  WHERE threads.deleted_at IS NULL
    AND ((sessions.active_turn_id IS NOT NULL AND sessions.status <> 'error')
      OR latest_turn.state = 'running'
      OR json_extract(runtime.runtime_payload_json, '$.activeTurnId') IS NOT NULL)
    AND MAX(COALESCE(sessions.updated_at, threads.updated_at), threads.updated_at) <= ?
  ORDER BY MAX(COALESCE(sessions.updated_at, threads.updated_at), threads.updated_at), threads.thread_id
  LIMIT ?
`;

const candidateQuery = `
  WITH candidate_threads AS (
    SELECT thread_id FROM projection_thread_sessions
    WHERE active_turn_id IS NOT NULL AND status <> 'error'
    UNION
    SELECT turns.thread_id
    FROM projection_turns AS turns
    JOIN projection_threads AS threads
      ON threads.thread_id = turns.thread_id AND threads.latest_turn_id = turns.turn_id
    WHERE turns.state = 'running'
    UNION
    SELECT thread_id FROM provider_session_runtime
    WHERE json_extract(runtime_payload_json, '$.activeTurnId') IS NOT NULL
  )
  SELECT threads.thread_id
  FROM candidate_threads AS candidates
  JOIN projection_threads AS threads ON threads.thread_id = candidates.thread_id
  LEFT JOIN projection_thread_sessions AS sessions ON sessions.thread_id = threads.thread_id
  WHERE threads.deleted_at IS NULL
    AND MAX(COALESCE(sessions.updated_at, threads.updated_at), threads.updated_at) <= ?
  ORDER BY MAX(COALESCE(sessions.updated_at, threads.updated_at), threads.updated_at), threads.thread_id
  LIMIT ?
`;

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function measure(query) {
  const statement = database.prepare(query);
  for (let index = 0; index < 3; index += 1) statement.all("2026-08-12T00:00:00.000Z", 1000);
  const samples = [];
  for (let index = 0; index < SAMPLE_COUNT; index += 1) {
    const startedAt = performance.now();
    statement.all("2026-08-12T00:00:00.000Z", 1000);
    samples.push(performance.now() - startedAt);
  }
  return { p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), samples };
}

try {
  database.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;
    CREATE TABLE projection_threads (
      thread_id TEXT PRIMARY KEY, latest_turn_id TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE projection_thread_sessions (
      thread_id TEXT PRIMARY KEY, status TEXT NOT NULL, active_turn_id TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE projection_turns (
      thread_id TEXT NOT NULL, turn_id TEXT NOT NULL, state TEXT NOT NULL,
      PRIMARY KEY (thread_id, turn_id)
    );
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY, runtime_payload_json TEXT
    );
  `);
  const insertThread = database.prepare("INSERT INTO projection_threads VALUES (?, ?, ?, NULL)");
  const insertSession = database.prepare("INSERT INTO projection_thread_sessions VALUES (?, ?, ?, ?)");
  const insertTurn = database.prepare("INSERT INTO projection_turns VALUES (?, ?, ?)");
  const insertRuntime = database.prepare("INSERT INTO provider_session_runtime VALUES (?, ?)");
  database.exec("BEGIN IMMEDIATE");
  for (let index = 0; index < THREAD_COUNT; index += 1) {
    const threadId = `thread-${String(index).padStart(8, "0")}`;
    const turnId = `turn-${String(index).padStart(8, "0")}`;
    const active = index % 1000 === 0;
    insertThread.run(threadId, active ? turnId : null, "2026-08-01T00:00:00.000Z");
    insertSession.run(threadId, active && index % 3 === 0 ? "running" : "ready", active && index % 3 === 0 ? turnId : null, "2026-08-01T00:00:00.000Z");
    if (active && index % 3 === 1) insertTurn.run(threadId, turnId, "running");
    if (active && index % 3 === 2) insertRuntime.run(threadId, JSON.stringify({ activeTurnId: turnId }));
  }
  database.exec("COMMIT");
  const before = { legacy: measure(legacyQuery), candidate: measure(candidateQuery) };
  database.exec(`
    CREATE INDEX idx_projection_thread_sessions_reconciliation
      ON projection_thread_sessions(updated_at, thread_id)
      WHERE active_turn_id IS NOT NULL AND status <> 'error';
    CREATE INDEX idx_projection_turns_running_thread
      ON projection_turns(thread_id, turn_id) WHERE state = 'running';
    CREATE INDEX idx_provider_session_runtime_active_turn
      ON provider_session_runtime(thread_id)
      WHERE json_extract(runtime_payload_json, '$.activeTurnId') IS NOT NULL;
  `);
  const after = measure(candidateQuery);
  console.log(JSON.stringify({
    createdAt: new Date().toISOString(),
    database: { threadCount: THREAD_COUNT, activeCount: Math.ceil(THREAD_COUNT / 1000), journalMode: "WAL", synchronous: "NORMAL" },
    before,
    after,
    queryPlan: database.prepare(`EXPLAIN QUERY PLAN ${candidateQuery}`).all("2026-08-12T00:00:00.000Z", 1000),
  }, null, 2));
} finally {
  database.close();
  rmSync(tempDirectory, { recursive: true, force: true });
}
