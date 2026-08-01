// FILE: startContainerChat.ts
// Purpose: Shared "ensure the Chats container project, then open a thread inside it" flow.
// Layer: Web orchestration helper
// Exports: Container-chat startup.

import type { ProjectId, ThreadId } from "@synara/contracts";
import type { NewThreadOptions } from "./threadBootstrap";

export type StartContainerChatResult =
  | { ok: true; threadId: ThreadId | null }
  | { ok: false; error: string };

/**
 * Resolves (creating if needed) the backing Chats container, then starts a thread inside it.
 */
export async function startContainerChat(input: {
  readonly ensureProjectId: () => Promise<ProjectId | null>;
  readonly handleNewThread: (
    projectId: ProjectId,
    options?: NewThreadOptions,
  ) => Promise<ThreadId | null>;
  readonly fresh?: boolean | undefined;
  readonly forceLocalWorkspace?: boolean | undefined;
  readonly errorLabel: string;
}): Promise<StartContainerChatResult> {
  try {
    const projectId = await input.ensureProjectId();
    if (!projectId) {
      return { ok: false, error: input.errorLabel };
    }
    const threadOptions: NewThreadOptions | undefined =
      input.fresh === true || input.forceLocalWorkspace === true
        ? {
            ...(input.fresh === true ? { fresh: true } : {}),
            envMode: "local",
            branch: null,
            worktreePath: null,
          }
        : undefined;
    const threadId = await input.handleNewThread(projectId, threadOptions);
    return { ok: true, threadId };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : input.errorLabel,
    };
  }
}
