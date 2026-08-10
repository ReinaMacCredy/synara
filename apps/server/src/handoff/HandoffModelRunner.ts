import { randomUUID } from "node:crypto";

import {
  ThreadId,
  type HandoffCapsuleItemV1,
  type HandoffCapsuleV1,
  type HandoffRuntimeSelection,
  type ProviderEvent,
} from "@synara/contracts";

import { CodexAppServerManager } from "../codexAppServerManager.ts";
import { HANDOFF_CORE_INSTRUCTION } from "./handoffCoreInstruction.ts";
import { makeHandoffToolRuntime } from "./handoffToolRuntime.ts";

const ORPHAN_SAFETY_CAP_MS = 30 * 60 * 1_000;

export interface HandoffModelRunInput {
  readonly capsule: HandoffCapsuleV1;
  readonly sourceItems: ReadonlyArray<HandoffCapsuleItemV1>;
  readonly runtime: HandoffRuntimeSelection;
  readonly globalGuidance: string;
  readonly handoffPrompt: string;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: { readonly phase: string; readonly percent: number }) => void;
}

export function buildHandoffTurnInput(input: {
  readonly capsule: HandoffCapsuleV1;
  readonly handoffPrompt: string;
}): string {
  return [
    "Prepare the handoff packet from this sealed capsule:",
    JSON.stringify(input.capsule),
    input.handoffPrompt.trim() ? `One-time handoff prompt:\n${input.handoffPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runHandoffModel(input: HandoffModelRunInput): Promise<unknown> {
  if (input.runtime.provider !== "codex") {
    throw new Error(`Handoff provider '${input.runtime.provider}' is not implemented.`);
  }
  const threadId = ThreadId.makeUnsafe(`handoff-runtime-${randomUUID()}`);
  const manager = new CodexAppServerManager();
  let output = "";
  let outputStarted = false;
  let settle: ((value: void) => void) | null = null;
  let reject: ((reason: Error) => void) | null = null;
  const completed = new Promise<void>((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });
  const onEvent = (event: ProviderEvent) => {
    if (event.textDelta) {
      output += event.textDelta;
      if (!outputStarted) {
        outputStarted = true;
        input.onProgress?.({ phase: "Finalizing handoff packet", percent: 85 });
      }
    }
    if (event.method === "turn/completed") {
      input.onProgress?.({ phase: "Validating handoff packet", percent: 95 });
      settle?.();
    }
    if (event.method === "turn/aborted") reject?.(new Error("Handoff Agent turn was aborted."));
    if (event.method === "error") reject?.(new Error("Handoff Agent failed."));
  };
  manager.on("event", onEvent);
  const timeout = setTimeout(
    () => reject?.(new Error("Handoff Agent exceeded its orphan safety cap.")),
    ORPHAN_SAFETY_CAP_MS,
  );
  const onAbort = () => reject?.(new Error("Handoff Agent preparation was cancelled."));
  input.signal.addEventListener("abort", onAbort, { once: true });
  try {
    input.onProgress?.({ phase: "Starting Handoff Agent", percent: 15 });
    await manager.startSession({
      threadId,
      model: input.runtime.model,
      runtimeMode: "approval-required",
      nativeToolRuntime: makeHandoffToolRuntime(input.sourceItems),
      developerInstructions: [
        HANDOFF_CORE_INSTRUCTION,
        input.globalGuidance.trim() ? `Owner's global guidance:\n${input.globalGuidance}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    input.onProgress?.({ phase: "Handoff Agent ready", percent: 35 });
    await manager.sendTurn({
      threadId,
      model: input.runtime.model,
      effort: input.runtime.effort,
      input: buildHandoffTurnInput(input),
    });
    input.onProgress?.({ phase: "Preparing cited handoff packet", percent: 55 });
    await completed;
    const trimmed = output.trim();
    const jsonStart = trimmed.indexOf("{");
    const jsonEnd = trimmed.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      throw new Error("Handoff Agent did not return a JSON packet.");
    }
    return JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener("abort", onAbort);
    manager.off("event", onEvent);
    await manager.stopAll().catch(() => undefined);
  }
}
