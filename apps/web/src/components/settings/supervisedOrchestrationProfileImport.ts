import type {
  ProfileApprovalPolicy,
  ProfileProviderKind,
  ProfileRuntimeConfig,
  ProfileSandboxMode,
  RoomRole,
} from "@synara/contracts";
import { parse as parseToml } from "smol-toml";

export const MAX_PROFILE_IMPORT_BYTES = 1024 * 1024;

export type ImportedProfilePreset = {
  readonly name: string;
  readonly roleHints: readonly RoomRole[];
  readonly runtime: ProfileRuntimeConfig;
};

const PROVIDERS = new Set<ProfileProviderKind>([
  "codex",
  "claudeAgent",
  "cursor",
  "antigravity",
  "grok",
  "droid",
  "kilo",
  "opencode",
  "pi",
]);
const ROLES = new Set(["lead", "peer", "specialist"]);
// TODO(synara): Remove the legacy Specialist import alias on or after 2027-08-09
// once profile exports from before the canonical Peer cutover are no longer supported.
const PEER_ROLE: RoomRole = "peer";
const SANDBOXES = new Set<ProfileSandboxMode>([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
const APPROVALS = new Set<ProfileApprovalPolicy>([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function profileImportFormat(fileName: string): "json" | "toml" {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".json")) return "json";
  if (normalized.endsWith(".toml")) return "toml";
  throw new Error("Choose a .json or .toml profile export.");
}

function profileNameFromFile(fileName: string): string {
  const stem = fileName.trim().replace(/\.(json|toml)$/i, "");
  const words = stem.split(/[-_.\s]+/).filter(Boolean);
  if (words.length === 0) return "Imported profile";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function inferNativeRoleHints(instructions: unknown): readonly RoomRole[] {
  if (typeof instructions !== "string") return [];
  const match = instructions.match(/\broom\s+role\s*:\s*(lead|peer|specialist)\b/i);
  if (!match?.[1]) return [];
  return [
    match[1].toLowerCase() === "specialist"
      ? PEER_ROLE
      : (match[1].toLowerCase() as RoomRole),
  ];
}

function normalizeNativeCodexProfile(
  parsed: Record<string, unknown>,
  fileName: string,
): Record<string, unknown> | null {
  if (typeof parsed.model !== "string") return null;

  const mappedKeys = new Set([
    "name",
    "profile_name",
    "role_hints",
    "model",
    "model_reasoning_effort",
    "sandbox_mode",
    "approval_policy",
    "developer_instructions",
  ]);
  const providerOptions = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => !mappedKeys.has(key)),
  );
  const roleHints = Array.isArray(parsed.role_hints)
    ? parsed.role_hints
    : inferNativeRoleHints(parsed.developer_instructions);

  return {
    name:
      typeof parsed.name === "string"
        ? parsed.name
        : typeof parsed.profile_name === "string"
          ? parsed.profile_name
          : profileNameFromFile(fileName),
    roleHints,
    runtime: {
      provider: "codex",
      model: parsed.model,
      reasoningEffort: parsed.model_reasoning_effort ?? null,
      sandboxMode: parsed.sandbox_mode,
      approvalPolicy: parsed.approval_policy,
      developerInstructions: parsed.developer_instructions ?? "",
      providerOptions,
    },
  };
}

export function parseProfileImport(text: string, fileName: string): ImportedProfilePreset {
  const format = profileImportFormat(fileName);
  let parsed: unknown;
  try {
    parsed = format === "json" ? JSON.parse(text) : parseToml(text);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not parse ${format.toUpperCase()}: ${detail}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("The selected file is not a supervision profile export.");
  }

  const normalized = isRecord(parsed.runtime)
    ? parsed
    : format === "toml"
      ? normalizeNativeCodexProfile(parsed, fileName)
      : null;
  if (!normalized || !isRecord(normalized.runtime)) {
    throw new Error("The selected file is not a supervision profile export or Codex profile.");
  }

  const runtime = normalized.runtime;
  const provider = requiredString(runtime.provider, "Provider") as ProfileProviderKind;
  if (!PROVIDERS.has(provider)) throw new Error(`Unsupported provider: ${provider}.`);

  const sandboxMode = requiredString(runtime.sandboxMode, "Sandbox") as ProfileSandboxMode;
  if (!SANDBOXES.has(sandboxMode)) throw new Error(`Unsupported sandbox: ${sandboxMode}.`);

  const approvalPolicy = requiredString(
    runtime.approvalPolicy,
    "Approval policy",
  ) as ProfileApprovalPolicy;
  if (!APPROVALS.has(approvalPolicy)) {
    throw new Error(`Unsupported approval policy: ${approvalPolicy}.`);
  }

  const rawRoleHints = normalized.roleHints ?? [];
  if (!Array.isArray(rawRoleHints) || rawRoleHints.some((role) => !ROLES.has(String(role)))) {
    throw new Error("Role hints must contain only lead or peer.");
  }
  const roleHints = rawRoleHints.map((role) =>
    role === "specialist" ? PEER_ROLE : (role as RoomRole),
  );

  const reasoningEffort = runtime.reasoningEffort;
  if (
    reasoningEffort !== undefined &&
    reasoningEffort !== null &&
    (typeof reasoningEffort !== "string" || !reasoningEffort.trim())
  ) {
    throw new Error("Reasoning effort must be a non-empty string or null.");
  }

  if (
    runtime.developerInstructions !== undefined &&
    typeof runtime.developerInstructions !== "string"
  ) {
    throw new Error("Developer instructions must be text.");
  }

  return {
    name: requiredString(normalized.name, "Name"),
    roleHints,
    runtime: {
      provider,
      model: requiredString(runtime.model, "Model"),
      reasoningEffort:
        typeof reasoningEffort === "string" ? reasoningEffort.trim() : (reasoningEffort ?? null),
      sandboxMode,
      approvalPolicy,
      developerInstructions: runtime.developerInstructions ?? "",
      providerOptions: runtime.providerOptions ?? {},
    },
  };
}

export async function readProfileImportFile(file: File): Promise<ImportedProfilePreset> {
  if (file.size > MAX_PROFILE_IMPORT_BYTES) {
    throw new Error("Profile exports must be 1 MB or smaller.");
  }
  return parseProfileImport(await file.text(), file.name);
}
