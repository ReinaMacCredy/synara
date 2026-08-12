// FILE: claudeNativeDiscovery.ts
// Purpose: Owns Claude native discovery normalization, settled caches, and single-flight state.
// Layer: Provider discovery

import type {
  AgentInfo,
  ModelInfo,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ProviderListAgentsResult,
  ProviderListCommandsResult,
  ProviderListModelsResult,
} from "@veylen/contracts";

export function mapClaudeCommands(commands: SlashCommand[]): ProviderListCommandsResult {
  return {
    commands: commands.map((command) => ({
      name: command.name,
      description: command.description || undefined,
    })),
    source: "claudeAgent",
    cached: false,
  };
}

export function mapClaudeModelInfo(model: ModelInfo): ProviderListModelsResult["models"][number] {
  return {
    slug: model.value,
    ...(model.resolvedModel ? { resolvedModel: model.resolvedModel } : {}),
    name: model.displayName,
    ...(typeof model.supportsAutoMode === "boolean"
      ? { supportsAutoMode: model.supportsAutoMode }
      : {}),
  };
}

export function mapClaudeAgentInfo(agent: AgentInfo): ProviderListAgentsResult["agents"][number] {
  return {
    name: agent.name,
    displayName: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    ...(agent.model ? { model: agent.model } : {}),
  };
}

export function neverResolvingClaudeDiscoveryStream(): AsyncIterable<SDKUserMessage> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
      return { next: async () => new Promise<IteratorResult<SDKUserMessage>>(() => {}) };
    },
  };
}

export class ClaudeNativeDiscoveryState {
  private commands: { readonly result: ProviderListCommandsResult; readonly cwd: string } | null =
    null;
  private models: ProviderListModelsResult | null = null;
  private agents: ProviderListAgentsResult | null = null;
  private pendingCommands: Promise<ProviderListCommandsResult> | null = null;
  private pendingModels: Promise<ProviderListModelsResult> | null = null;
  private pendingAgents: Promise<ProviderListAgentsResult> | null = null;

  getCommands(cwd: string, forceReload = false): ProviderListCommandsResult | null {
    return this.commands?.cwd === cwd && !forceReload
      ? { ...this.commands.result, cached: true }
      : null;
  }

  setCommands(cwd: string, result: ProviderListCommandsResult): void {
    this.commands = { cwd, result };
  }

  getModels(): ProviderListModelsResult | null {
    return this.models ? { ...this.models, cached: true } : null;
  }

  setModels(result: ProviderListModelsResult): void {
    this.models = result;
  }

  getAgents(): ProviderListAgentsResult | null {
    return this.agents ? { ...this.agents, cached: true } : null;
  }

  setAgents(result: ProviderListAgentsResult): void {
    this.agents = result;
  }

  discoverCommands(
    start: () => Promise<ProviderListCommandsResult>,
  ): Promise<ProviderListCommandsResult> {
    if (this.pendingCommands) return this.pendingCommands;
    const pending = start().finally(() => {
      if (this.pendingCommands === pending) this.pendingCommands = null;
    });
    this.pendingCommands = pending;
    return pending;
  }

  discoverModels(
    start: () => Promise<ProviderListModelsResult>,
  ): Promise<ProviderListModelsResult> {
    if (this.pendingModels) return this.pendingModels;
    const pending = start().finally(() => {
      if (this.pendingModels === pending) this.pendingModels = null;
    });
    this.pendingModels = pending;
    return pending;
  }

  discoverAgents(
    start: () => Promise<ProviderListAgentsResult>,
  ): Promise<ProviderListAgentsResult> {
    if (this.pendingAgents) return this.pendingAgents;
    const pending = start().finally(() => {
      if (this.pendingAgents === pending) this.pendingAgents = null;
    });
    this.pendingAgents = pending;
    return pending;
  }
}
