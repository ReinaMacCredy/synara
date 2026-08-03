import type { OrchestratorToolExecutionResult } from "../orchestration/orchestrator/toolRuntime.ts";

export interface CodexDynamicToolResponse {
  readonly success: true;
  readonly contentItems: ReadonlyArray<{
    readonly type: "inputText";
    readonly text: string;
  }>;
}

export function codexDynamicToolResponse(
  result: OrchestratorToolExecutionResult,
): CodexDynamicToolResponse {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify(result.ok ? result.value : { ok: false, error: result.error }),
      },
    ],
  };
}
