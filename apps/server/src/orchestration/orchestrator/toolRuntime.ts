import type {
  OrchestratorProviderCapability,
  OrchestratorToolName,
  ProviderKind,
} from "@synara/contracts";
import type { Effect } from "effect";

export type OrchestratorToolProviderSupport = "native" | "unsupported";

export interface OrchestratorToolDefinition {
  readonly name: OrchestratorToolName;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  readonly providerSupport: Readonly<Record<"codex" | "claude", OrchestratorToolProviderSupport>>;
}

export interface OrchestratorToolInvocationContext {
  readonly callerThreadId: string;
  readonly callerSessionKey: string;
  readonly callerProvider: ProviderKind;
  readonly callerTurnId: string | null;
  readonly resolveOrchestratorCapability: (input: {
    readonly provider: ProviderKind;
    readonly model: string;
  }) => Effect.Effect<OrchestratorProviderCapability, OrchestratorToolError>;
  readonly assertCallerTurnActive: () => Effect.Effect<void, OrchestratorToolError>;
}

export interface OrchestratorToolEntry {
  readonly definition: OrchestratorToolDefinition;
  readonly isVisible: (context: OrchestratorToolInvocationContext) => Effect.Effect<boolean>;
  readonly execute: (
    args: Record<string, unknown>,
    context: OrchestratorToolInvocationContext,
  ) => Effect.Effect<OrchestratorToolExecutionResult>;
}

export type OrchestratorToolExecutionResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
    };

export class OrchestratorToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const orchestratorToolFailure = (error: unknown): OrchestratorToolExecutionResult => {
  const normalized =
    error instanceof OrchestratorToolError
      ? error
      : new OrchestratorToolError(
          "orchestrator_tool_failed",
          error instanceof Error ? error.message : String(error),
        );
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.details === undefined ? {} : { details: normalized.details }),
    },
  };
};

export const orchestratorToolSuccess = (value: unknown): OrchestratorToolExecutionResult => ({
  ok: true,
  value,
});
