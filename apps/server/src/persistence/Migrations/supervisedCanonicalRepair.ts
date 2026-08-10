import { isDeepStrictEqual } from "node:util";

import { ProfilePresetId, type ProfilePreset, type RoomRole } from "@veylen/contracts";
import { Effect } from "effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

import { columnExists } from "./schemaHelpers.ts";

const at = new Date(0).toISOString();

const makeLegacySeed = (input: {
  readonly id: string;
  readonly name: string;
  readonly role: RoomRole;
  readonly instructions: string;
}): ProfilePreset => ({
  id: ProfilePresetId.makeUnsafe(input.id),
  name: input.name,
  roleHints: [input.role],
  runtime: {
    provider: "codex",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    developerInstructions: input.instructions,
    providerOptions: { features: { multi_agent: false, multi_agent_v2: false } },
  },
  isDefault: true,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  revision: 1,
});

const LEGACY_LEAD_INSTRUCTIONS = `Room role: Lead. You are the active outcome owner for one Project Lead Room.
Own the project outcome, topology, cross-scope engineering decisions, integration, verification routing, and acceptance. Use Specialists for independent judgment inside explicit scopes without pre-solving their conclusions. Resolve ordinary cross-scope decisions yourself and surface only owner decisions, irreversible risk, or authority gaps that genuinely require the user.
Treat Supervised Runtime signals as attributable evidence, not project acceptance and not a replacement for your judgment. Follow authenticated owner directives within their stated scope, discuss material evidence disagreement directly, and never treat a Specialist, provider-native worker, lifecycle notification, or derived signal as proof that the project outcome is accepted.`;

const LEGACY_SPECIALIST_INSTRUCTIONS = `Room role: Specialist. You are a persistent engineering collaborator responsible for the judgment inside the scope assigned by Lead.
Treat the brief as an outcome and ownership boundary, not a prescribed conclusion. Investigate enough to form your own technical position, reject a false premise, and reopen a material architecture constraint when evidence shows it endangers the outcome. Converse directly with Lead about cross-scope decisions, changed contracts, or consequential disagreement; make ordinary local decisions yourself.
Independent judgment is not performative dissent. Do not manufacture objections, alternatives, speculative blockers, or approval requests to demonstrate rigor. Agreement is valid when the evidence supports it. Raise only issues that can materially change the result, route, boundary, or confidence.
Stay within the room's single-owner law and report evidence honestly. Your responsibility may be implementation, investigation, architecture, review, audit, or advice; own that temporary responsibility rather than behaving as a one-shot answer function.`;

const FROZEN_LEGACY_DEFAULT_PROFILES = [
  makeLegacySeed({
    id: "profile-lead-default",
    name: "Lead Default",
    role: "lead",
    instructions: LEGACY_LEAD_INSTRUCTIONS,
  }),
  makeLegacySeed({
    id: "profile-peer-implementer",
    name: "Specialist Implementer",
    role: "peer",
    instructions: `${LEGACY_SPECIALIST_INSTRUCTIONS}\nYour temporary responsibility is implementation. Own the assigned outcome through evidence and handback to Lead.`,
  }),
  makeLegacySeed({
    id: "profile-peer-reviewer",
    name: "Specialist Reviewer",
    role: "peer",
    instructions: `${LEGACY_SPECIALIST_INSTRUCTIONS}\nYour temporary responsibility is review. Report only material findings with evidence and return acceptance to Lead.`,
  }),
] as const;

const canonicalProfile = (profile: ProfilePreset): ProfilePreset => ({
  ...profile,
  name: profile.name.replace("Specialist", "Peer"),
  runtime: {
    ...profile.runtime,
    developerInstructions: profile.runtime.developerInstructions
      .replaceAll("Specialists", "Peers")
      .replaceAll("Specialist", "Peer"),
  },
});

const LEGACY_DEFAULT_PROFILES = new Map(
  FROZEN_LEGACY_DEFAULT_PROFILES.map((profile) => [profile.id, profile]),
);
const CANONICAL_DEFAULT_PROFILES = new Map(
  FROZEN_LEGACY_DEFAULT_PROFILES.map((profile) => [profile.id, canonicalProfile(profile)]),
);

const sameProfile = (left: unknown, right: unknown) => isDeepStrictEqual(left, right);

export const upcastLegacyDefaultProfiles = (
  profiles: ReadonlyArray<ProfilePreset>,
): ReadonlyArray<ProfilePreset> => {
  let changed = false;
  const next = profiles.map((profile) => {
    const legacy = LEGACY_DEFAULT_PROFILES.get(profile.id);
    const canonical = CANONICAL_DEFAULT_PROFILES.get(profile.id);
    if (!legacy || !canonical || !sameProfile(profile, legacy)) return profile;
    changed = true;
    return canonical;
  });
  return changed ? next : profiles;
};

export const repairCanonicalProfiles = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly orchestrationJson: string }>`
      SELECT orchestration_json AS "orchestrationJson"
      FROM supervised_governance_state
      WHERE singleton_id = 1
    `;
    const row = rows[0];
    if (!row) return;
    const snapshot = JSON.parse(row.orchestrationJson) as {
      readonly profiles?: ReadonlyArray<ProfilePreset>;
      readonly [key: string]: unknown;
    };
    if (!Array.isArray(snapshot.profiles)) return;
    const profiles = upcastLegacyDefaultProfiles(snapshot.profiles);
    if (profiles === snapshot.profiles) return;
    yield* sql`
      UPDATE supervised_governance_state
      SET orchestration_json = ${JSON.stringify({ ...snapshot, profiles })}
      WHERE singleton_id = 1
    `;
  });

export const ensurePeerModelSessionRoleConstraint = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const definitions = yield* sql<{ readonly definition: string | null }>`
      SELECT sql AS definition
      FROM sqlite_master
      WHERE type = 'table' AND name = 'projection_supervised_model_sessions'
    `;
    if (definitions[0]?.definition?.includes("'peer'")) return;
    if (!(yield* columnExists(sql, "projection_supervised_model_sessions", "thread_id"))) {
      yield* sql`ALTER TABLE projection_supervised_model_sessions ADD COLUMN thread_id TEXT`;
    }
    yield* sql`DROP TABLE IF EXISTS projection_supervised_model_sessions_peer`;
    yield* sql`
      CREATE TABLE projection_supervised_model_sessions_peer (
        model_session_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        task_node_id TEXT,
        rlm_episode_id TEXT,
        parent_session_id TEXT,
        role TEXT NOT NULL CHECK (role IN ('lead', 'peer', 'specialist', 'rlm_root', 'rlm_branch')),
        status TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision >= 0),
        updated_at TEXT NOT NULL,
        entity_json TEXT NOT NULL CHECK (json_valid(entity_json)),
        thread_id TEXT,
        FOREIGN KEY (room_id) REFERENCES projection_supervised_rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES projection_supervised_runs(run_id) ON DELETE CASCADE,
        FOREIGN KEY (task_node_id) REFERENCES projection_supervised_task_nodes(task_node_id) ON DELETE SET NULL
      )
    `;
    yield* sql`
      INSERT INTO projection_supervised_model_sessions_peer (
        model_session_id, room_id, run_id, task_node_id, rlm_episode_id,
        parent_session_id, role, status, revision, updated_at, entity_json, thread_id
      )
      SELECT
        model_session_id, room_id, run_id, task_node_id, rlm_episode_id,
        parent_session_id, role, status, revision, updated_at, entity_json, thread_id
      FROM projection_supervised_model_sessions
    `;
    yield* sql`DROP TABLE projection_supervised_model_sessions`;
    yield* sql`
      ALTER TABLE projection_supervised_model_sessions_peer
      RENAME TO projection_supervised_model_sessions
    `;
    yield* sql`
      CREATE INDEX idx_supervised_model_sessions_room_role
      ON projection_supervised_model_sessions(room_id, role, updated_at DESC, model_session_id)
    `;
    yield* sql`
      CREATE INDEX idx_supervised_model_sessions_task_node
      ON projection_supervised_model_sessions(task_node_id, updated_at DESC, model_session_id)
    `;
    yield* sql`
      CREATE INDEX idx_supervised_model_sessions_rlm_episode
      ON projection_supervised_model_sessions(rlm_episode_id, parent_session_id, updated_at, model_session_id)
    `;
    yield* sql`
      CREATE INDEX idx_supervised_model_sessions_thread
      ON projection_supervised_model_sessions(thread_id, updated_at DESC, model_session_id)
    `;
  });
