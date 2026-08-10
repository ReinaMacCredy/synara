import type { ClientOrchestrationCommand, OrchestrationCommand } from "@veylen/contracts";
import { isWorkspaceRootWithin, workspaceRootsEqual } from "@veylen/shared/threadWorkspace";
import type { FileSystem, Path } from "effect";
import { Effect, Schedule } from "effect";

import { createAttachmentId } from "../attachmentStore";

export interface DispatchCommandNormalizerResult<E> {
  readonly command: OrchestrationCommand;
  /**
   * Deferred workspace-root scaffolding decided during normalization but NOT yet executed.
   * Callers must run this only after the normalized command has been successfully accepted
   * by the orchestration decider (e.g. after `orchestrationEngine.dispatch` resolves), so a
   * rejected dispatch (for example a cross-kind workspace-root ownership conflict) never
   * mutates the filesystem.
   */
  readonly prepareWorkspaceRoot: Effect.Effect<void, E> | null;
}

export interface DispatchCommandNormalizerOptions<E> {
  readonly attachmentsDir: string;
  readonly chatWorkspaceRoot?: string;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly canonicalizeProjectWorkspaceRoot: (
    workspaceRoot: string,
    options?: { readonly createIfMissing?: boolean },
  ) => Effect.Effect<string, E>;
  readonly prepareChatWorkspaceRoot?: (workspaceRoot: string) => Effect.Effect<void, E>;
}

// Deferred workspace-root scaffolding can transiently fail on a flaky filesystem even though the underlying
// operation is safe to retry (it's idempotent recursive directory creation). Since this runs
// AFTER the orchestration decider has already accepted the dispatch (see wsRpc), a single
// transient failure here would otherwise permanently strand the project row without its
// managed subdirectories. Retry a bounded number of times with a short
// backoff before letting the failure surface to the caller.
const WORKSPACE_ROOT_PREPARE_RETRY_SCHEDULE = Schedule.exponential("100 millis").pipe(
  Schedule.take(2),
);

export function makeDispatchCommandNormalizer<E>(options: DispatchCommandNormalizerOptions<E>) {
  // Per-thread chat roots live strictly within chatWorkspaceRoot; exact equality is excluded
  // so managed subdirectories are never scaffolded into the shared parent directory.
  const maybePrepareWorkspaceRoot = (input: {
    readonly command: Extract<
      ClientOrchestrationCommand,
      { type: "project.create" | "project.meta.update" }
    >;
    readonly workspaceRoot: string;
    readonly configuredWorkspaceRoot: string | undefined;
    readonly prepare: ((workspaceRoot: string) => Effect.Effect<void, E>) | undefined;
  }) => {
    const { command, workspaceRoot, configuredWorkspaceRoot, prepare } = input;
    if (
      command.kind !== "chat" ||
      command.createWorkspaceRootIfMissing !== true ||
      !configuredWorkspaceRoot ||
      !prepare
    ) {
      return Effect.void;
    }
    const isWithin = isWorkspaceRootWithin(workspaceRoot, configuredWorkspaceRoot);
    const isEqual = workspaceRootsEqual(workspaceRoot, configuredWorkspaceRoot);
    if (!isWithin || isEqual) {
      return Effect.void;
    }
    return prepare(workspaceRoot).pipe(Effect.retry(WORKSPACE_ROOT_PREPARE_RETRY_SCHEDULE));
  };
  const maybePrepareChatWorkspaceRoot = (
    command: Extract<
      ClientOrchestrationCommand,
      { type: "project.create" | "project.meta.update" }
    >,
    workspaceRoot: string,
  ) =>
    maybePrepareWorkspaceRoot({
      command,
      workspaceRoot,
      configuredWorkspaceRoot: options.chatWorkspaceRoot,
      prepare: options.prepareChatWorkspaceRoot,
    });
  const deferredPrepareWorkspaceRoot = (
    command: Extract<
      ClientOrchestrationCommand,
      { type: "project.create" | "project.meta.update" }
    >,
    workspaceRoot: string,
  ): Effect.Effect<void, E> => maybePrepareChatWorkspaceRoot(command, workspaceRoot);

  return Effect.fnUntraced(function* (input: { readonly command: ClientOrchestrationCommand }) {
    if (input.command.type === "project.create") {
      // Known trade-off: canonicalization may create the (empty) root directory before the
      // decider validates ownership — realpath-based canonicalization needs the directory to
      // exist, and comparing lexical paths instead would mis-handle symlinked roots. A rejected
      // command can therefore leave an empty directory behind, but never scaffolding: the
      // subdirectory prepare is deferred until the dispatch is accepted (see wsRpc).
      const workspaceRoot = yield* options.canonicalizeProjectWorkspaceRoot(
        input.command.workspaceRoot,
        {
          createIfMissing: input.command.createWorkspaceRootIfMissing === true,
        },
      );
      const command = {
        ...input.command,
        workspaceRoot,
        createWorkspaceRootIfMissing: input.command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
      return {
        command,
        prepareWorkspaceRoot: deferredPrepareWorkspaceRoot(input.command, workspaceRoot),
      };
    }

    if (input.command.type === "project.meta.update" && input.command.workspaceRoot !== undefined) {
      const workspaceRoot = yield* options.canonicalizeProjectWorkspaceRoot(
        input.command.workspaceRoot,
        {
          createIfMissing: input.command.createWorkspaceRootIfMissing === true,
        },
      );
      const command = {
        ...input.command,
        workspaceRoot,
        createWorkspaceRootIfMissing: input.command.createWorkspaceRootIfMissing === true,
      } satisfies OrchestrationCommand;
      return {
        command,
        prepareWorkspaceRoot: deferredPrepareWorkspaceRoot(input.command, workspaceRoot),
      };
    }

    if (input.command.type !== "thread.turn.start") {
      return {
        command: input.command as OrchestrationCommand,
        prepareWorkspaceRoot: null,
      };
    }
    const turnStartCommand = input.command;

    const normalizedAttachments = yield* Effect.forEach(
      turnStartCommand.message.attachments,
      (attachment) =>
        Effect.gen(function* () {
          if (attachment.type === "assistant-selection") {
            const attachmentId = createAttachmentId(turnStartCommand.threadId);
            if (!attachmentId) {
              return yield* Effect.fail(new Error("Failed to create a safe attachment id."));
            }

            return {
              type: "assistant-selection" as const,
              id: attachmentId,
              assistantMessageId: attachment.assistantMessageId,
              text: attachment.text,
            };
          }

          // Binary attachment metadata is resolved from the durable managed
          // attachment ledger by OrchestrationEngine immediately before its
          // atomic event/receipt claim. Client metadata is never authoritative.
          return attachment;
        }),
      { concurrency: 1 },
    );

    return {
      command: {
        ...turnStartCommand,
        message: {
          ...turnStartCommand.message,
          attachments: normalizedAttachments,
        },
      } satisfies OrchestrationCommand,
      prepareWorkspaceRoot: null,
    };
  });
}
