import { createHash, randomUUID } from "node:crypto";

import {
  HandoffAttemptId,
  HandoffCapsuleV1,
  HandoffId,
  HandoffGrantId,
  HandoffPacketV1,
  type AcceptedCrossModeHandoffV1,
  type GetHandoffPreparationInput,
  type HandoffConversationMode,
  type HandoffPreparationSnapshot,
  type HandoffRuntimeSelection,
  type StartHandoffPreparationInput,
} from "@synara/contracts";
import { Effect, Layer, Option, Schema, ServiceMap } from "effect";

import { ProjectionOrchestratorRepository } from "../../persistence/Services/ProjectionOrchestrator.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  HANDOFF_CORE_INSTRUCTION_HASH,
  HANDOFF_CORE_INSTRUCTION_VERSION,
} from "../handoffCoreInstruction.ts";
import { runHandoffModel } from "../HandoffModelRunner.ts";
import { projectHandoffPacketSourceReferences } from "../handoffPacketProjection.ts";
import { canonicalHandoffSourceItems, handoffSourceDigest } from "../handoffSourceMaterial.ts";

const sha256 = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

export interface HandoffPreparationServiceShape {
  readonly start: (
    input: StartHandoffPreparationInput,
  ) => Effect.Effect<HandoffPreparationSnapshot, Error>;
  readonly get: (
    input: GetHandoffPreparationInput,
  ) => Effect.Effect<HandoffPreparationSnapshot, Error>;
  readonly cancel: (
    input: GetHandoffPreparationInput,
  ) => Effect.Effect<HandoffPreparationSnapshot, Error>;
  readonly accept: (input: {
    readonly attemptId: GetHandoffPreparationInput["attemptId"];
    readonly destinationThreadId: HandoffPreparationSnapshot["destinationDraftThreadId"];
    readonly destinationMode: HandoffConversationMode;
    readonly projectId: HandoffCapsuleV1["projectId"];
    readonly sourceLinkOnly: boolean;
  }) => Effect.Effect<AcceptedCrossModeHandoffV1, Error>;
}

export class HandoffPreparationService extends ServiceMap.Service<
  HandoffPreparationService,
  HandoffPreparationServiceShape
>()("synara/handoff/Services/HandoffPreparationService") {}

const makeHandoffPreparationService = Effect.gen(function* () {
  const projections = yield* ProjectionSnapshotQuery;
  const orchestratorProjections = yield* ProjectionOrchestratorRepository;
  const settings = yield* ServerSettingsService;
  const attempts = new Map<
    string,
    { snapshot: HandoffPreparationSnapshot; controller: AbortController }
  >();

  const sourceMode = (threadId: string) =>
    orchestratorProjections.findRootForThread(threadId).pipe(
      Effect.map((root) =>
        Option.match(root, {
          onNone: () => "project" as const,
          onSome: (rootThreadId) =>
            rootThreadId === threadId
              ? ("orchestrator_root" as const)
              : ("orchestrator_child" as const),
        }),
      ),
    );

  const start: HandoffPreparationServiceShape["start"] = (input) =>
    Effect.gen(function* () {
      const detailOption = yield* projections.getThreadDetailSnapshotById(input.sourceThreadId);
      if (Option.isNone(detailOption)) {
        return yield* Effect.fail(
          new Error(`Source thread '${input.sourceThreadId}' was not found.`),
        );
      }
      const detail = detailOption.value;
      const projectOption = yield* projections.getProjectShellById(detail.thread.projectId);
      if (Option.isNone(projectOption)) {
        return yield* Effect.fail(new Error("Source Project was not found."));
      }
      const project = projectOption.value;
      const mode = yield* sourceMode(input.sourceThreadId);
      const now = new Date().toISOString();
      const sourceItems = canonicalHandoffSourceItems(detail.thread.messages);
      const capsuleBase = {
        schemaVersion: 1 as const,
        sourceThreadId: input.sourceThreadId,
        sourceTitle: detail.thread.title,
        sourceMode: mode,
        sourceProvider: detail.thread.modelSelection.provider,
        projectId: detail.thread.projectId,
        projectTitle: project.title,
        workspaceRoot: project.workspaceRoot,
        environment: {
          mode: detail.thread.envMode ?? (detail.thread.worktreePath ? "worktree" : "local"),
          branch: detail.thread.branch,
          worktreePath: detail.thread.worktreePath,
        },
        sourceCursor: detail.snapshotSequence,
        sourceDigest: handoffSourceDigest(sourceItems),
        items: sourceItems.slice(-32),
        omissions:
          sourceItems.length > 32
            ? [
                `${sourceItems.length - 32} earlier messages remain available through bounded source reads.`,
              ]
            : [],
        sealedAt: now,
      };
      const capsule = input.sealedCapsule
        ? Schema.decodeUnknownSync(HandoffCapsuleV1)(input.sealedCapsule)
        : Schema.decodeUnknownSync(HandoffCapsuleV1)({
            ...capsuleBase,
            capsuleHash: sha256(capsuleBase),
          });
      if (capsule.sourceThreadId !== input.sourceThreadId) {
        return yield* Effect.fail(
          new Error("The sealed handoff capsule belongs to another source thread."),
        );
      }
      if (capsule.projectId !== detail.thread.projectId || capsule.sourceMode !== mode) {
        return yield* Effect.fail(
          new Error(
            "The sealed handoff capsule no longer matches the source Project or conversation mode.",
          ),
        );
      }
      if (input.sealedCapsule) {
        const { capsuleHash: _capsuleHash, ...sealedBase } = capsule;
        if (sha256(sealedBase) !== capsule.capsuleHash) {
          return yield* Effect.fail(
            new Error("The sealed handoff capsule failed integrity validation."),
          );
        }
      }
      const readableSourceItems = input.sealedCapsule ? capsule.items : sourceItems;
      const settingsSnapshot = yield* settings.getSnapshot;
      const runtime =
        input.runtime ??
        ({
          provider: settingsSnapshot.settings.handoffAgent.provider,
          model: settingsSnapshot.settings.handoffAgent.model,
          effort: settingsSnapshot.settings.handoffAgent.effort,
        } satisfies HandoffRuntimeSelection);
      const handoffId = HandoffId.makeUnsafe(`handoff-${randomUUID()}`);
      const attemptId = HandoffAttemptId.makeUnsafe(`handoff-attempt-${randomUUID()}`);
      const snapshot: HandoffPreparationSnapshot = {
        attemptId,
        handoffId,
        destinationDraftThreadId: input.destinationDraftThreadId,
        state: "preparing",
        phase: "Sealing source context",
        progressPercent: 0,
        runtime,
        settingsRevision: settingsSnapshot.revision,
        capsule,
        handoffPrompt: input.handoffPrompt,
        packet: null,
        error: null,
        startedAt: now,
        updatedAt: now,
      };
      const controller = new AbortController();
      attempts.set(attemptId, { snapshot, controller });
      void runHandoffModel({
        capsule,
        sourceItems: readableSourceItems,
        runtime,
        globalGuidance: settingsSnapshot.settings.handoffAgent.customGuidance,
        handoffPrompt: input.handoffPrompt,
        signal: controller.signal,
        onProgress: ({ phase, percent }) => {
          const current = attempts.get(attemptId);
          if (
            !current ||
            current.controller.signal.aborted ||
            current.snapshot.state !== "preparing"
          ) {
            return;
          }
          current.snapshot = {
            ...current.snapshot,
            phase,
            progressPercent: percent,
            updatedAt: new Date().toISOString(),
          };
        },
      }).then(
        (raw) => {
          const current = attempts.get(attemptId);
          if (!current || current.controller.signal.aborted) return;
          try {
            const body = projectHandoffPacketSourceReferences(raw, readableSourceItems) as Record<
              string,
              unknown
            >;
            const packet = Schema.decodeUnknownSync(HandoffPacketV1)({
              ...body,
              schemaVersion: 1,
              provenance: {
                sourceThreadId: input.sourceThreadId,
                sourceMode: mode,
                destinationMode: input.destinationMode,
                sourceCursor: capsule.sourceCursor,
                sourceDigest: capsule.sourceDigest,
                capsuleHash: capsule.capsuleHash,
                runtime,
                settingsRevision: settingsSnapshot.revision,
                coreInstructionVersion: HANDOFF_CORE_INSTRUCTION_VERSION,
                coreInstructionHash: HANDOFF_CORE_INSTRUCTION_HASH,
                ownerGuidanceHash: sha256(settingsSnapshot.settings.handoffAgent.customGuidance),
                handoffPromptHash: sha256(input.handoffPrompt),
                attemptId,
                packetRevision: 1,
              },
            });
            const allowedRefs = new Set(readableSourceItems.map((item) => item.ref));
            const claims = [
              packet.objective,
              ...packet.ownerConstraints,
              ...packet.currentState,
              ...packet.progress,
              ...packet.decisions.accepted,
              ...packet.decisions.rejected,
              ...packet.decisions.disputed,
              ...packet.decisions.superseded,
              ...packet.verification,
              ...packet.failedAttempts,
              ...packet.blockers,
              ...packet.risks,
              ...packet.dissent,
              ...packet.openQuestions,
              ...packet.nextActions,
            ];
            const unknownCitation = [
              ...packet.citations.map((citation) => citation.ref),
              ...claims.flatMap((claim) => claim.citations),
            ].find((ref) => !allowedRefs.has(ref));
            if (unknownCitation) {
              throw new Error(`Handoff packet cited an unavailable source '${unknownCitation}'.`);
            }
            current.snapshot = {
              ...current.snapshot,
              state: "ready",
              phase: "Handoff packet ready",
              progressPercent: 100,
              packet,
              updatedAt: new Date().toISOString(),
            };
          } catch (error) {
            current.snapshot = {
              ...current.snapshot,
              state: "failed",
              phase: "Packet validation failed",
              error:
                error instanceof Error ? error.message.slice(0, 32_768) : "Invalid handoff packet.",
              updatedAt: new Date().toISOString(),
            };
          }
        },
        (error) => {
          const current = attempts.get(attemptId);
          if (!current || current.controller.signal.aborted) return;
          current.snapshot = {
            ...current.snapshot,
            state: "failed",
            phase: "Handoff Agent failed",
            error:
              error instanceof Error ? error.message.slice(0, 32_768) : "Handoff Agent failed.",
            updatedAt: new Date().toISOString(),
          };
        },
      );
      return snapshot;
    }).pipe(
      Effect.mapError((error) => (error instanceof Error ? error : new Error(String(error)))),
    );

  const get: HandoffPreparationServiceShape["get"] = (input) =>
    Effect.try({
      try: () => {
        const attempt = attempts.get(input.attemptId);
        if (!attempt) throw new Error(`Handoff attempt '${input.attemptId}' is no longer active.`);
        return attempt.snapshot;
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });

  const cancel: HandoffPreparationServiceShape["cancel"] = (input) =>
    get(input).pipe(
      Effect.map((snapshot) => {
        const attempt = attempts.get(input.attemptId)!;
        attempt.controller.abort();
        attempt.snapshot = {
          ...snapshot,
          state: "cancelled",
          phase: "Preparation cancelled",
          updatedAt: new Date().toISOString(),
        };
        return attempt.snapshot;
      }),
    );

  const accept: HandoffPreparationServiceShape["accept"] = (input) =>
    get({ attemptId: input.attemptId }).pipe(
      Effect.flatMap((snapshot) =>
        Effect.try({
          try: () => {
            if (snapshot.destinationDraftThreadId !== input.destinationThreadId) {
              throw new Error("The handoff attempt belongs to another destination draft.");
            }
            if (snapshot.capsule.projectId !== input.projectId) {
              throw new Error("Cross-mode handoff must remain in the source Project.");
            }
            if (snapshot.packet?.provenance.destinationMode !== input.destinationMode) {
              if (!input.sourceLinkOnly) {
                throw new Error("The prepared packet belongs to another destination mode.");
              }
            }
            if (!input.sourceLinkOnly && (snapshot.state !== "ready" || snapshot.packet === null)) {
              throw new Error(
                "The handoff packet is not ready. Retry it or explicitly use source-link-only mode.",
              );
            }
            if (input.sourceLinkOnly && snapshot.state === "preparing") {
              throw new Error("Cancel preparation before using source-link-only mode.");
            }
            const createdAt = new Date().toISOString();
            const grantId = HandoffGrantId.makeUnsafe(
              `handoff-grant-${sha256(`${snapshot.handoffId}:${input.destinationThreadId}`).slice(0, 32)}`,
            );
            return {
              schemaVersion: 1,
              handoffId: snapshot.handoffId,
              sourceTitle: snapshot.capsule.sourceTitle,
              sourceMode: snapshot.capsule.sourceMode,
              destinationMode: input.destinationMode,
              sourceCursor: snapshot.capsule.sourceCursor,
              sourceDigest: snapshot.capsule.sourceDigest,
              capsule: snapshot.capsule,
              handoffPrompt: snapshot.handoffPrompt,
              packet: input.sourceLinkOnly ? null : snapshot.packet,
              sourceLinkOnly: input.sourceLinkOnly,
              grant: {
                grantId,
                handoffId: snapshot.handoffId,
                sourceThreadId: snapshot.capsule.sourceThreadId,
                destinationThreadId: input.destinationThreadId,
                projectId: input.projectId,
                allowedViews: [
                  "status",
                  "last_message",
                  "tail_since_cursor",
                  "transcript",
                  "artifacts",
                  "activity",
                ],
                grantedThroughCursor: snapshot.capsule.sourceCursor,
                status: "active",
                revision: 1,
                createdAt,
                lastAccessedAt: null,
                revokedAt: null,
              },
            } satisfies AcceptedCrossModeHandoffV1;
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      ),
    );

  return { start, get, cancel, accept } satisfies HandoffPreparationServiceShape;
});

export const HandoffPreparationServiceLive = Layer.effect(
  HandoffPreparationService,
  makeHandoffPreparationService,
);
