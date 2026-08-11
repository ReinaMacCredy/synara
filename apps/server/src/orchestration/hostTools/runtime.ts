import type {
  ProviderKind,
  SupervisedIntentToolId,
  SupervisedToolInvocationReceipt,
} from "@veylen/contracts";
import type { Effect } from "effect";

export type HostToolProviderSupport = "native" | "unsupported";

export interface HostToolDefinition {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  readonly providerSupport: Readonly<Record<"codex" | "claude", HostToolProviderSupport>>;
  readonly supervised?: {
    readonly toolId: SupervisedIntentToolId;
    readonly schemaVersion: "1.0.0";
  };
}

export interface HostToolInvocationContext {
  readonly callerThreadId: string;
  readonly callerSessionKey: string;
  readonly callerProvider: ProviderKind;
  readonly callerTurnId: string | null;
  readonly callerDispatchOrigin?: "user" | "automation" | "agent" | "supervised";
  readonly assertCallerTurnActive: () => Effect.Effect<void, HostToolError>;
}

export interface HostToolEntry {
  readonly definition: HostToolDefinition;
  readonly isVisible: (context: HostToolInvocationContext) => Effect.Effect<boolean>;
  readonly execute: (
    args: Record<string, unknown>,
    context: HostToolInvocationContext,
  ) => Effect.Effect<HostToolExecutionResult>;
}

export type HostToolExecutionResult =
  | {
      readonly ok: true;
      readonly value: unknown;
      readonly receipt?: SupervisedToolInvocationReceipt;
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly details?: unknown;
      };
      readonly receipt?: SupervisedToolInvocationReceipt;
    };

export class HostToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const hostToolFailure = (error: unknown): HostToolExecutionResult => {
  const normalized =
    error instanceof HostToolError
      ? error
      : new HostToolError(
          "host_tool_failed",
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

export const hostToolSuccess = (value: unknown): HostToolExecutionResult => ({
  ok: true,
  value,
});

export const hostToolTranscriptValue = (result: HostToolExecutionResult): unknown => {
  const base = result.ok ? result.value : { ok: false, error: result.error };
  if (!result.receipt) return base;
  if (base !== null && typeof base === "object" && !Array.isArray(base)) {
    return { ...base, _veylenReceipt: result.receipt };
  }
  return { value: base, _veylenReceipt: result.receipt };
};
