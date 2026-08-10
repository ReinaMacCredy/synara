// FILE: settingsNavigation.ts
// Purpose: Share the settings topic taxonomy between the main sidebar and the settings screen.
// Layer: Route/UI support
// Exports: section ids, nav items, and search normalization helper

export const SETTINGS_SECTION_IDS = [
  "general",
  "profile",
  "appearance",
  "notifications",
  "behavior",
  "appsnap",
  "shortcuts",
  "worktrees",
  "archived",
  "models",
  "supervised-general",
  "supervised-profiles",
  "supervised-models",
  "supervised-notebook",
  "supervised-authority",
  "supervised-lifecycle",
  "supervised-tools",
  "supervised-subscriptions",
  "supervised-plugins",
  "supervised-runtime",
  "supervised-diagnostics",
  "handoff-agent",
  "handoff-access",
  "providers",
  "skills",
  "usage",
  "integrations",
  "advanced",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsNavGroupId =
  | "personal"
  | "integrations"
  | "coding"
  | "supervised"
  | "system"
  | "archived";

/**
 * Deep-link scroll targets inside settings panels. Each id is shared by its DOM owner and callers
 * that navigate with `?target=…`; the settings route resolves every target after the active panel
 * mounts.
 */
export const SETTINGS_TARGETS = {
  providerUpdates: "provider-updates",
  environmentPanel: "environment-panel",
} as const;

export type SettingsNavItem = {
  id: SettingsSectionId;
  group: SettingsNavGroupId;
  label: string;
  description: string;
  /** Basename of a SVG under `/central-icons-reversed`. */
  icon: string;
  eyebrow: string;
};

export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  id: SettingsNavGroupId;
  label: string;
}> = [
  { id: "personal", label: "Personal" },
  { id: "integrations", label: "Integrations" },
  { id: "coding", label: "Coding" },
  { id: "supervised", label: "Supervised" },
  { id: "system", label: "System" },
  { id: "archived", label: "Archived" },
] as const;

export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  {
    id: "general",
    group: "personal",
    label: "General",
    description: "Choose defaults for new chats, navigation, and the Environment panel.",
    icon: "settings-gear-4",
    eyebrow: "Workflow defaults",
  },
  {
    id: "profile",
    group: "personal",
    label: "Profile",
    description: "Your local activity, streaks, and a shareable stats card.",
    icon: "user",
    eyebrow: "Your stats",
  },
  {
    id: "appearance",
    group: "personal",
    label: "Appearance",
    description: "Customize the theme, typography, density, and time format.",
    icon: "color-palette",
    eyebrow: "Visual language",
  },
  {
    id: "notifications",
    group: "personal",
    label: "Notifications",
    description: "Choose how Synara tells you when work finishes or needs attention.",
    icon: "bell",
    eyebrow: "Alerts",
  },
  {
    id: "behavior",
    group: "personal",
    label: "Chat behavior",
    description: "Control live responses, follow-ups, review defaults, and safety confirmations.",
    icon: "settings-slider-hor",
    eyebrow: "Interaction rules",
  },
  {
    id: "shortcuts",
    group: "personal",
    label: "Keybindings",
    description: "Capture, customize, and add shortcuts for every Synara command.",
    icon: "shortcut",
    eyebrow: "Key bindings",
  },
  {
    id: "usage",
    group: "personal",
    label: "Usage & limits",
    description: "See remaining quota and credits for every signed-in provider.",
    icon: "gauge",
    eyebrow: "Provider limits",
  },
  {
    id: "appsnap",
    group: "integrations",
    label: "AppSnap",
    description: "Capture another app's frontmost window directly into a task.",
    icon: "screen-capture",
    eyebrow: "Screen capture",
  },
  {
    id: "integrations",
    group: "integrations",
    label: "MCP connections",
    description: "Give Codex, Claude, and other local agents scoped access to Synara tasks.",
    icon: "plugin-1",
    eyebrow: "External agents",
  },
  {
    id: "providers",
    group: "coding",
    label: "Agent providers",
    description: "Choose visible coding agents and manage their installed CLI tools.",
    icon: "puzzle",
    eyebrow: "Coding agents",
  },
  {
    id: "models",
    group: "coding",
    label: "Models & writing",
    description: "Choose the model used for Git writing and add custom model slugs.",
    icon: "brain",
    eyebrow: "Model configuration",
  },
  {
    id: "handoff-agent",
    group: "coding",
    label: "Handoff Agent",
    description: "Configure the one-shot agent that prepares cited cross-mode context packets.",
    icon: "arrow-right-left",
    eyebrow: "Context transfer",
  },
  {
    id: "handoff-access",
    group: "coding",
    label: "Handoff access",
    description: "Inspect and revoke durable source-read grants created by accepted handoffs.",
    icon: "chain-link-4",
    eyebrow: "Source access",
  },
  {
    id: "skills",
    group: "coding",
    label: "Agent skills",
    description: "Review reusable workflows discovered across all configured providers.",
    icon: "building-blocks",
    eyebrow: "Reusable workflows",
  },
  {
    id: "worktrees",
    group: "coding",
    label: "Managed worktrees",
    description: "Review and clean up isolated workspaces created by Synara.",
    icon: "branch-simple",
    eyebrow: "Workspace management",
  },
  {
    id: "supervised-general",
    group: "supervised",
    label: "General",
    description:
      "See the owner control plane, active Rooms, attention signals, and durable health.",
    icon: "settings-gear-4",
    eyebrow: "Control plane",
  },
  {
    id: "supervised-profiles",
    group: "supervised",
    label: "Roles & profiles",
    description:
      "Manage existing Lead and Peer profile presets without changing their saved identity.",
    icon: "agents",
    eyebrow: "Roles and presets",
  },
  {
    id: "supervised-models",
    group: "supervised",
    label: "Models",
    description:
      "Inspect governed capabilities and set durable owner routing preferences and fallbacks.",
    icon: "brain",
    eyebrow: "Model routing",
  },
  {
    id: "supervised-notebook",
    group: "supervised",
    label: "Shared notebook",
    description:
      "Search durable shared knowledge, evidence, cursors, compaction, and supersession history.",
    icon: "notes",
    eyebrow: "Durable knowledge",
  },
  {
    id: "supervised-authority",
    group: "supervised",
    label: "Mandates & authority",
    description:
      "Review directives, mandates, Root leases, effective authority, and interventions.",
    icon: "safe-simple",
    eyebrow: "Governance",
  },
  {
    id: "supervised-lifecycle",
    group: "supervised",
    label: "Lifecycle",
    description:
      "Inspect Workspace, Room, AgentSeat, provider-session, handoff, and intervention lifecycle.",
    icon: "progress-25",
    eyebrow: "Runtime lifecycle",
  },
  {
    id: "supervised-tools",
    group: "supervised",
    label: "System tools",
    description:
      "Control durable tool policy and inspect schemas, authority, health, and invocation receipts.",
    icon: "toolbox",
    eyebrow: "Governed tools",
  },
  {
    id: "supervised-subscriptions",
    group: "supervised",
    label: "Subscriptions",
    description: "Reuse the existing Subscriptions & Triggers UI and its persisted configuration.",
    icon: "bell",
    eyebrow: "Signals and triggers",
  },
  {
    id: "supervised-plugins",
    group: "supervised",
    label: "Plugins",
    description: "Install and govern local plugins, grants, circuit health, and typed actions.",
    icon: "plugin-2",
    eyebrow: "Plugin registry",
  },
  {
    id: "supervised-runtime",
    group: "supervised",
    label: "Runtime",
    description:
      "Inspect daemon, Signal Plane, programmable kernels, RunPolicy, and recovery controls.",
    icon: "gauge",
    eyebrow: "Runtime control plane",
  },
  {
    id: "supervised-diagnostics",
    group: "supervised",
    label: "Diagnostics",
    description:
      "Open bounded logs, copy diagnostics, and inspect audit, schemas, delivery, and DeadLetters.",
    icon: "ladybug",
    eyebrow: "Evidence and recovery",
  },
  {
    id: "advanced",
    group: "system",
    label: "System tools",
    description: "Manage sessions, recovery tools, low-level keybindings, and version details.",
    icon: "toolbox",
    eyebrow: "System tools",
  },
  {
    id: "archived",
    group: "archived",
    label: "Archived chats",
    description: "Find and restore archived chats and Lead Rooms.",
    icon: "archive",
    eyebrow: "Conversation history",
  },
] as const;

/**
 * Stable DOM id for a settings row, derived from its (string) title. Shared by the row that
 * renders the anchor and by the search index that deep-links to it via `?target=…`, so the
 * two can't drift. Panels stay mounted and render null while inactive, so the slug only needs
 * to be unique within a section.
 */
export function settingRowAnchorId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `setting-${slug}`;
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  if (typeof value !== "string") {
    return "general";
  }
  if (value === "supervised-orchestration") return "supervised-profiles";
  return SETTINGS_SECTION_IDS.find((candidate) => candidate === value) ?? "general";
}
