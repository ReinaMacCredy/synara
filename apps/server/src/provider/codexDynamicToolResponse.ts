import {
  hostToolTranscriptValue,
  type HostToolExecutionResult,
} from "../orchestration/hostTools/runtime.ts";

export interface CodexDynamicToolResponse {
  readonly success: true;
  readonly contentItems: ReadonlyArray<{
    readonly type: "inputText";
    readonly text: string;
  }>;
}

export function codexDynamicToolResponse(
  result: HostToolExecutionResult,
): CodexDynamicToolResponse {
  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify(hostToolTranscriptValue(result)),
      },
    ],
  };
}
