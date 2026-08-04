import type { ProfilePreset, SupervisionSnapshot } from "@synara/contracts";

const SECRET_KEY = /token|secret|password|api[_-]?key|credential/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : redact(entry),
    ]),
  );
}

export const exportProfilePreset = (preset: ProfilePreset): string =>
  JSON.stringify(redact(preset), null, 2);

export const redactSupervisionSnapshotForShell = (
  snapshot: SupervisionSnapshot,
): SupervisionSnapshot => ({
  ...snapshot,
  profiles: snapshot.profiles.map((profile) => ({
    ...profile,
    runtime: {
      provider: profile.runtime.provider,
      model: profile.runtime.model,
      reasoningEffort: profile.runtime.reasoningEffort,
      sandboxMode: profile.runtime.sandboxMode,
      approvalPolicy: profile.runtime.approvalPolicy,
      developerInstructions: "[available in profile detail]",
    },
  })),
  profileSnapshots: snapshot.profileSnapshots.map((profile) => ({
    ...profile,
    runtime: {
      provider: profile.runtime.provider,
      model: profile.runtime.model,
      reasoningEffort: profile.runtime.reasoningEffort,
      sandboxMode: profile.runtime.sandboxMode,
      approvalPolicy: profile.runtime.approvalPolicy,
      developerInstructions: "[available in profile detail]",
    },
  })),
});
