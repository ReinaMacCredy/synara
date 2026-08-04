import type {
  ProfilePreset,
  ProfileRuntimeConfig,
  ProfileSnapshot,
  ProfileSnapshotId,
} from "@synara/contracts";
import { createHash } from "node:crypto";

const CODEX_PROFILE_FEATURE_KEYS = new Set(["multi_agent", "multi_agent_v2"]);

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export function codexProfileConfigArgs(runtime: ProfileRuntimeConfig): string[] {
  const options = runtime.providerOptions === undefined ? {} : record(runtime.providerOptions);
  if (options === null) {
    throw new Error("Codex profile provider options must be a JSON object.");
  }
  const unsupportedTopLevel = Object.keys(options).filter((key) => key !== "features");
  if (unsupportedTopLevel.length > 0) {
    throw new Error(`Unsupported Codex profile option group: ${unsupportedTopLevel.join(", ")}.`);
  }
  const features = options.features === undefined ? {} : record(options.features);
  if (features === null) {
    throw new Error("Codex profile features must be a JSON object.");
  }
  const unsupportedFeatures = Object.keys(features).filter(
    (key) => !CODEX_PROFILE_FEATURE_KEYS.has(key),
  );
  if (unsupportedFeatures.length > 0) {
    throw new Error(`Unsupported Codex profile feature: ${unsupportedFeatures.join(", ")}.`);
  }
  const args: string[] = [];
  for (const key of [...CODEX_PROFILE_FEATURE_KEYS].toSorted()) {
    const value = features[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      throw new Error(`Codex profile feature '${key}' must be boolean.`);
    }
    args.push(value ? "--enable" : "--disable", key);
  }
  return args;
}

const stableRuntimeJson = (preset: ProfilePreset): string =>
  JSON.stringify({
    provider: preset.runtime.provider,
    model: preset.runtime.model,
    reasoningEffort: preset.runtime.reasoningEffort,
    sandboxMode: preset.runtime.sandboxMode,
    approvalPolicy: preset.runtime.approvalPolicy,
    developerInstructions: preset.runtime.developerInstructions,
    providerOptions: preset.runtime.providerOptions ?? null,
  });

export function resolveProfilePreset(input: {
  readonly preset: ProfilePreset;
  readonly snapshotId: ProfileSnapshotId;
  readonly createdAt: string;
}): ProfileSnapshot {
  return {
    id: input.snapshotId,
    sourcePresetId: input.preset.id,
    sourcePresetName: input.preset.name,
    runtime: input.preset.runtime,
    contentHash: createHash("sha256").update(stableRuntimeJson(input.preset)).digest("hex"),
    createdAt: input.createdAt,
  };
}

export function profileLaunchIssue(preset: ProfilePreset): string | null {
  if (preset.archivedAt !== null) return "Archived profiles cannot launch a seat.";
  if (preset.runtime.model.trim().length === 0) {
    return `${preset.runtime.provider} profiles require an explicit model.`;
  }
  if (
    preset.runtime.providerOptions !== undefined &&
    typeof preset.runtime.providerOptions !== "object"
  ) {
    return "Provider options must use the selected provider's native object shape.";
  }
  if (preset.runtime.provider !== "codex") {
    return `Supervised seats do not yet have a proven native authority channel for provider '${preset.runtime.provider}'. Choose Codex or add adapter support explicitly; no fallback was applied.`;
  }
  try {
    codexProfileConfigArgs(preset.runtime);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}
