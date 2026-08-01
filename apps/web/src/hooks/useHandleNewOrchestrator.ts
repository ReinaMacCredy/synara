import {
  type ModelSlug,
  type ModelSelection,
  type ProjectId,
  type ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from "@synara/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { buildThreadHandoffImportedMessages } from "../lib/threadHandoff";
import { orchestratorQueryKeys } from "../lib/orchestratorRoots";
import { promoteThreadCreate } from "../lib/threadCreatePromotion";
import { newCommandId, newThreadId } from "../lib/utils";
import { readNativeApi } from "../nativeApi";
import { useStore } from "../store";
import { DEFAULT_INTERACTION_MODE, type Project, type Thread } from "../types";

const ORCHESTRATOR_HANDOFF_MESSAGE_LIMIT = 24;

export interface CreateOrchestratorInput {
  readonly project: Project;
  readonly title: string;
  readonly provider: ProviderKind;
  readonly model: string;
  readonly runtimeMode: RuntimeMode;
  readonly sourceThread?: Thread | null;
}

export function buildOrchestratorHandoffMessages(thread: Thread) {
  return buildThreadHandoffImportedMessages(thread).slice(-ORCHESTRATOR_HANDOFF_MESSAGE_LIMIT);
}

export function useHandleNewOrchestrator() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const syncServerShellSnapshot = useStore((store) => store.syncServerShellSnapshot);

  const createOrchestrator = async (input: CreateOrchestratorInput): Promise<ThreadId> => {
    const api = readNativeApi();
    if (!api) throw new Error("The Synara server is unavailable.");
    if (input.project.kind !== "project" || input.project.cwd.trim().length === 0) {
      throw new Error("An Orchestrator Root requires a real Project workspace.");
    }

    const title = input.title.trim();
    const model = input.model.trim();
    if (!title) throw new Error("Enter a title for the Orchestrator Root.");
    if (!model) throw new Error("Select a model for the Orchestrator Root.");
    if (input.sourceThread && input.sourceThread.projectId !== input.project.id) {
      throw new Error("A curated handoff must stay in the source thread's Project.");
    }

    const rootThreadId = newThreadId();
    const createdAt = new Date().toISOString();
    const modelSelection: ModelSelection = {
      provider: input.provider,
      model: model as ModelSlug,
    };

    if (input.sourceThread) {
      const importedMessages = buildOrchestratorHandoffMessages(input.sourceThread);
      if (importedMessages.length === 0) {
        throw new Error(
          "The source thread has no completed user or assistant messages to hand off.",
        );
      }
      await api.orchestration.dispatchCommand({
        type: "thread.handoff.create",
        commandId: newCommandId(),
        threadId: rootThreadId,
        sourceThreadId: input.sourceThread.id,
        projectId: input.project.id,
        title,
        modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        envMode: "local",
        branch: null,
        worktreePath: null,
        workingDirectory: input.project.cwd,
        associatedWorktreePath: null,
        associatedWorktreeBranch: null,
        associatedWorktreeRef: null,
        createBranchFlowCompleted: false,
        importedMessages: [...importedMessages],
        createdAt,
      });
    } else {
      await promoteThreadCreate(
        {
          type: "thread.create",
          commandId: newCommandId(),
          threadId: rootThreadId,
          projectId: input.project.id,
          title,
          modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: DEFAULT_INTERACTION_MODE,
          envMode: "local",
          branch: null,
          worktreePath: null,
          workingDirectory: input.project.cwd,
          lastKnownPr: null,
          createdAt,
        },
        api,
        { force: true },
      );
    }

    try {
      await api.orchestration.createOrchestratorRoot({
        command: {
          type: "orchestrator.root.create",
          commandId: newCommandId(),
          rootThreadId,
          projectId: input.project.id as ProjectId,
          actor: { kind: "user", actorId: "owner" },
          protocolVersion: 1,
          expectedRevision: 0,
          modelTarget: {
            provider: input.provider,
            model,
            runtimeMode: input.runtimeMode,
            workspaceRoot: input.project.cwd,
          },
          title,
          activeProcessId: null,
          createdAt,
        },
      });
    } catch (error) {
      await api.orchestration
        .dispatchCommand({
          type: "thread.delete",
          commandId: newCommandId(),
          threadId: rootThreadId,
        })
        .catch(() => undefined);
      throw error;
    }

    const snapshot = await api.orchestration.getShellSnapshot();
    syncServerShellSnapshot(snapshot);
    await queryClient.invalidateQueries({ queryKey: orchestratorQueryKeys.all });
    await navigate({
      to: "/orchestrator/$rootThreadId",
      params: { rootThreadId },
    });
    return rootThreadId;
  };

  return { createOrchestrator };
}
