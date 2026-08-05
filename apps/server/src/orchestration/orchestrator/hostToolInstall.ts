// FILE: hostToolInstall.ts
// Purpose: Documents and helpers for the unified Orchestrator host-tool install matrix.
// One catalog (OrchestratorToolRuntime); three provider install classes.
// Layer: Orchestration host tools
// Exports: install class constants and capability flag helpers

/**
 * Unified install matrix (same tool names/schemas for the model):
 *
 * | Class | Providers | How tools reach the model |
 * |-------|-----------|---------------------------|
 * | A – Native host tools | codex | app-server `dynamicTools` + `item/tool/call` |
 * | B – In-process SDK MCP | claudeAgent | `createSdkMcpServer` wired to the same runtime |
 * | C – Session MCP | cursor, grok, droid, antigravity, opencode, kilo, pi* | Synara MCP attached at session start |
 *
 * *Pi projects the MCP catalog into its native custom-tool API (wrapper, not a second catalog).
 *
 * Source of truth for schemas + execute: OrchestratorToolRuntime.
 * Transports differ; the model always calls create_child_thread / list_provider_capabilities / …
 */

export const ORCHESTRATOR_HOST_TOOL_INSTALL = {
  codex: "native-dynamic-tools",
  claudeAgent: "in-process-sdk-mcp",
  cursor: "session-mcp",
  grok: "session-mcp",
  droid: "session-mcp",
  antigravity: "session-mcp",
  opencode: "session-mcp",
  kilo: "session-mcp",
  pi: "session-mcp-native-wrapper",
} as const;

export type OrchestratorHostToolInstallClass =
  (typeof ORCHESTRATOR_HOST_TOOL_INSTALL)[keyof typeof ORCHESTRATOR_HOST_TOOL_INSTALL];

/** Synara MCP server name used for class B/C installs. */
export const SYNARA_ORCHESTRATOR_MCP_SERVER_NAME = "synara";
