import type {
  ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListAgentsInput,
  ProviderListAgentsResult,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListModelsInput,
  ProviderListModelsResult,
  OrchestratorProviderCapability,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
  ProviderListSkillsInput,
  ProviderListSkillsResult,
  ProviderReadPluginInput,
  ProviderReadPluginResult,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type {
  ProviderAdapterError,
  ProviderUnsupportedError,
  ProviderValidationError,
} from "../Errors.ts";

export type ProviderDiscoveryError =
  | ProviderValidationError
  | ProviderUnsupportedError
  | ProviderAdapterError;

export interface ProviderDiscoveryServiceShape {
  readonly getComposerCapabilities: (
    input: ProviderGetComposerCapabilitiesInput,
  ) => Effect.Effect<ProviderComposerCapabilities, ProviderDiscoveryError>;
  readonly listCommands: (
    input: ProviderListCommandsInput,
  ) => Effect.Effect<ProviderListCommandsResult, ProviderDiscoveryError>;
  readonly listSkills: (
    input: ProviderListSkillsInput,
  ) => Effect.Effect<ProviderListSkillsResult, ProviderDiscoveryError>;
  readonly listPlugins: (
    input: ProviderListPluginsInput,
  ) => Effect.Effect<ProviderListPluginsResult, ProviderDiscoveryError>;
  readonly readPlugin: (
    input: ProviderReadPluginInput,
  ) => Effect.Effect<ProviderReadPluginResult, ProviderDiscoveryError>;
  readonly listModels: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ProviderListModelsResult, ProviderDiscoveryError>;
  /** Mechanical provider/model conformance and telemetry facts for Root reasoning. */
  readonly listOrchestratorCapabilities: (
    input: ProviderListModelsInput,
  ) => Effect.Effect<ReadonlyArray<OrchestratorProviderCapability>, ProviderDiscoveryError>;
  readonly getOrchestratorCapability: (
    input: ProviderListModelsInput & { readonly model: string },
  ) => Effect.Effect<OrchestratorProviderCapability, ProviderDiscoveryError>;
  readonly listAgents: (
    input: ProviderListAgentsInput,
  ) => Effect.Effect<ProviderListAgentsResult, ProviderDiscoveryError>;
}

export class ProviderDiscoveryService extends ServiceMap.Service<
  ProviderDiscoveryService,
  ProviderDiscoveryServiceShape
>()("synara/provider/Services/ProviderDiscoveryService") {}
