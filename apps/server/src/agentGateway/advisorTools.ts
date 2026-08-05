// FILE: advisorTools.ts
// Purpose: Agent-gateway tool that creates an Advisor consultation via the same
//          thread.fork.create path as the web tray / ask-user flows, then blocks
//          until the Advisor child reaches a terminal turn state.
// Layer: Agent gateway tools

import { createHash, randomUUID } from "node:crypto";

import {
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type ThreadHandoffImportedMessage,
} from "@synara/contracts";
import {
  ADVISOR_NICKNAME,
  ADVISOR_ROLE,
  buildAdvisorConsultationPrompt,
  extractAdvisorConsultationQuestion,
  isAdvisorIdentity,
  type AdvisorOrigin,
} from "@synara/shared/advisor";
import { Effect, Option } from "effect";

import type { OrchestrationEngineShape } from "../orchestration/Services/OrchestrationEngine.ts";
import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ServerSettingsShape } from "../serverSettings.ts";
import { mcpToolResultError, mcpToolResultJson } from "./protocol.ts";
import { gatewayIsoNow as isoNow } from "./creationUtils.ts";
import { errorText, readStringArg, ToolInputError } from "./toolInput.ts";
import { WRITE_TOOL_ANNOTATIONS, type ToolEntry } from "./toolRuntime.ts";

const ADVISOR_POLL_MS = 400;

function stableAdvisorIds(parentThreadId: string, question: string) {
  const digest = createHash("sha256")
    .update(JSON.stringify({ parentThreadId, question: question.trim() }))
    .digest("hex")
    .slice(0, 24);
  const nonce = randomUUID().slice(0, 8);
  const id = `${digest}${nonce}`;
  return {
    threadId: ThreadId.makeUnsafe(`advisor-${id}`),
    forkCommandId: CommandId.makeUnsafe(`advisor:${id}:fork`),
    turnCommandId: CommandId.makeUnsafe(`advisor:${id}:turn`),
    messageId: MessageId.makeUnsafe(`advisor:${id}:message`),
  };
}

function buildAdvisorThreadTitle(question: string): string {
  const normalized = question.trim().replace(/\s+/g, " ");
  const suffix = normalized.length > 52 ? `${normalized.slice(0, 49).trimEnd()}…` : normalized;
  return suffix.length > 0 ? `Advisor: ${suffix}` : "Advisor";
}

function importParentMessages(
  parent: OrchestrationThread,
): ReadonlyArray<ThreadHandoffImportedMessage> {
  const imported: ThreadHandoffImportedMessage[] = [];
  for (const message of parent.messages) {
    if (message.streaming !== false) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    imported.push({
      messageId: MessageId.makeUnsafe(randomUUID()),
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    });
  }
  return imported;
}

function sleep(ms: number) {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

function latestAdvisorAnswer(thread: OrchestrationThread): string | null {
  const questionIndex = thread.messages.findLastIndex(
    (message) =>
      message.role === "user" && extractAdvisorConsultationQuestion(message.text) !== null,
  );
  if (questionIndex < 0) return null;
  const answer = thread.messages
    .slice(questionIndex + 1)
    .findLast((message) => message.role === "assistant" && message.streaming === false);
  const text = answer?.text.trim() ?? "";
  return text.length > 0 ? text : null;
}

export function makeAgentGatewayAdvisorTools(input: {
  readonly orchestrationEngine: OrchestrationEngineShape;
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly serverSettings: ServerSettingsShape;
  readonly requireThreadShell: (
    threadId: string,
  ) => Effect.Effect<OrchestrationThreadShell, ToolInputError>;
}): ReadonlyArray<ToolEntry> {
  const { orchestrationEngine, snapshotQuery, serverSettings, requireThreadShell } = input;

  const consultAdvisor: ToolEntry = {
    requiredCapability: "thread:write",
    requiresActiveTurn: true,
    definition: {
      name: "synara_consult_advisor",
      description:
        "Ask Synara Advisor for a bounded second opinion when material uncertainty blocks a sound decision. Creates the same durable Advisor consultation as the user tray (Settings default Advisor model, advice-only, approval-required). Blocks until advice is ready or the consultation fails. Do not use provider spawn_agent for Advisor. One running consultation per parent task.",
      inputSchema: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "Concrete question for Advisor. Keep it decision-shaped and specific.",
          },
        },
        required: ["question"],
        additionalProperties: false,
      },
      annotations: {
        title: "Consult Advisor",
        ...WRITE_TOOL_ANNOTATIONS,
      },
    },
    handler: (args, context) =>
      Effect.gen(function* () {
        const question = readStringArg(args, "question", { required: true })!.trim();
        if (question.length === 0) {
          throw new ToolInputError('Argument "question" must not be empty.');
        }

        const parentShell = yield* requireThreadShell(context.callerThreadId);
        if (
          isAdvisorIdentity({
            nickname: parentShell.subagentNickname,
            role: parentShell.subagentRole,
            title: parentShell.title,
          })
        ) {
          throw new ToolInputError("Advisor cannot consult Advisor.");
        }

        // One running Advisor per parent (server-side).
        const shellSnapshot = yield* snapshotQuery.getShellSnapshot().pipe(
          Effect.mapError((error) => new ToolInputError(errorText(error))),
        );
        const runningAdvisor = shellSnapshot.threads.find(
          (shell) =>
            shell.parentThreadId === parentShell.id &&
            isAdvisorIdentity({
              nickname: shell.subagentNickname,
              role: shell.subagentRole,
              title: shell.title,
            }) &&
            shell.latestTurn?.state === "running",
        );
        if (runningAdvisor) {
          throw new ToolInputError(
            `An Advisor consultation is already running (${runningAdvisor.id}). Wait for it to finish before starting another.`,
          );
        }

        const parentDetailOption = yield* snapshotQuery.getThreadDetailById(parentShell.id).pipe(
          Effect.mapError((error) => new ToolInputError(errorText(error))),
        );
        const parentDetail = Option.getOrNull(parentDetailOption);
        if (!parentDetail) {
          throw new ToolInputError(`Parent thread "${parentShell.id}" was not found.`);
        }

        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError((error) => new ToolInputError(errorText(error))),
        );
        const modelSelection: ModelSelection = settings.advisorModelSelection;
        const origin: AdvisorOrigin = "agent";
        const advisorPrompt = buildAdvisorConsultationPrompt(
          question,
          settings.advisorCustomInstructions,
          origin,
        );
        const ids = stableAdvisorIds(parentShell.id, question);
        const createdAt = isoNow();
        const importedMessages = importParentMessages(parentDetail);

        yield* orchestrationEngine
          .dispatch({
            type: "thread.fork.create",
            commandId: ids.forkCommandId,
            threadId: ids.threadId,
            sourceThreadId: parentShell.id,
            projectId: parentShell.projectId,
            title: buildAdvisorThreadTitle(question),
            modelSelection,
            runtimeMode: "approval-required",
            interactionMode: "default",
            envMode: parentShell.envMode ?? (parentShell.worktreePath ? "worktree" : "local"),
            branch: parentShell.branch,
            worktreePath: parentShell.worktreePath,
            workingDirectory: parentShell.workingDirectory ?? null,
            associatedWorktreePath: parentShell.associatedWorktreePath ?? null,
            associatedWorktreeBranch: parentShell.associatedWorktreeBranch ?? null,
            associatedWorktreeRef: parentShell.associatedWorktreeRef ?? null,
            createBranchFlowCompleted: parentShell.createBranchFlowCompleted ?? false,
            parentThreadId: parentShell.id,
            subagentNickname: ADVISOR_NICKNAME,
            subagentRole: ADVISOR_ROLE,
            importedMessages: [...importedMessages],
            createdAt,
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));

        yield* orchestrationEngine
          .dispatch({
            type: "thread.turn.start",
            commandId: ids.turnCommandId,
            threadId: ids.threadId,
            message: {
              messageId: ids.messageId,
              role: "user",
              text: advisorPrompt,
              attachments: [],
            },
            modelSelection,
            assistantDeliveryMode: "streaming",
            dispatchMode: "queue",
            runtimeMode: "approval-required",
            interactionMode: "default",
            createdAt: isoNow(),
          })
          .pipe(Effect.mapError((error) => new ToolInputError(errorText(error))));

        // Block until the Advisor child reaches a terminal turn state (D2/D6).
        while (true) {
          const childOption = yield* snapshotQuery.getThreadDetailById(ids.threadId).pipe(
            Effect.mapError((error) => new ToolInputError(errorText(error))),
          );
          const child = Option.getOrNull(childOption);
          if (!child) {
            yield* sleep(ADVISOR_POLL_MS);
            continue;
          }

          const turnState = child.latestTurn?.state ?? null;
          const sessionError =
            child.session?.status === "error"
              ? (child.session.lastError ?? "Advisor session error")
              : null;
          const error = sessionError;

          if (turnState === "running" || turnState === null) {
            yield* sleep(ADVISOR_POLL_MS);
            continue;
          }

          if (turnState === "completed") {
            const advice = latestAdvisorAnswer(child);
            if (advice) {
              return mcpToolResultJson({
                status: "complete",
                origin: "agent",
                threadId: ids.threadId,
                question,
                advice,
                modelSelection,
              });
            }
            return mcpToolResultError(
              JSON.stringify({
                status: "complete",
                origin: "agent",
                threadId: ids.threadId,
                question,
                error: "Advisor completed without a response.",
                modelSelection,
              }),
            );
          }

          if (turnState === "interrupted") {
            return mcpToolResultError(
              JSON.stringify({
                status: "stopped",
                origin: "agent",
                threadId: ids.threadId,
                question,
                error: "Advisor stopped before completing.",
                modelSelection,
              }),
            );
          }

          return mcpToolResultError(
            JSON.stringify({
              status: "error",
              origin: "agent",
              threadId: ids.threadId,
              question,
              error: error ?? "Advisor could not complete.",
              modelSelection,
            }),
          );
        }
      }).pipe(Effect.catch((error) => Effect.succeed(mcpToolResultError(errorText(error))))),
  };

  return [consultAdvisor];
}
