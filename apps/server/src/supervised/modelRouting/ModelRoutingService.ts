import {
  type ModelCapabilityProfile,
  type ModelSelectionReceipt,
  type ModelSelectionReceiptId,
  type ModelTelemetryAggregate,
  type UserModelPreferenceProfile,
} from "@synara/contracts";
import { Effect, Layer, ServiceMap } from "effect";

import type { ProjectionRepositoryError } from "../../persistence/Errors.ts";
import { SupervisedGovernanceRepository } from "../../persistence/Services/SupervisedGovernanceRepository.ts";
import {
  aggregateModelOutcome,
  createModelSelectionReceipt,
  recommendModels,
  type ModelOutcomeInput,
  type ModelRecommendation,
  type ModelRoutingRequest,
} from "./ModelRouting.ts";

export class ModelRoutingDomainError extends Error {
  readonly _tag = "ModelRoutingDomainError";

  constructor(
    readonly code:
      | "capability_profile_conflict"
      | "preference_profile_conflict"
      | "unknown_capability_profile"
      | "routing_authority_denied"
      | "routing_revision_conflict"
      | "no_valid_candidate",
    message: string,
  ) {
    super(message);
  }
}

export interface PutModelCapabilityProfileInput {
  readonly profile: ModelCapabilityProfile;
  readonly expectedRevision: number | null;
}

export interface PutUserModelPreferenceProfileInput {
  readonly profile: UserModelPreferenceProfile;
  readonly expectedRevision: number | null;
}

export interface SelectModelInput {
  readonly receiptId: ModelSelectionReceiptId;
  readonly request: ModelRoutingRequest;
}

export interface UserModelRoutingState {
  readonly routingRevision: number;
  readonly capabilityProfiles: readonly ModelCapabilityProfile[];
  readonly preferenceProfile: UserModelPreferenceProfile | null;
  readonly telemetryAggregates: readonly ModelTelemetryAggregate[];
}

type ModelRoutingServiceError = ProjectionRepositoryError | ModelRoutingDomainError;

export interface ModelRoutingServiceShape {
  readonly getState: (
    userId: string,
  ) => Effect.Effect<UserModelRoutingState, ProjectionRepositoryError>;
  readonly putCapabilityProfile: (
    input: PutModelCapabilityProfileInput,
  ) => Effect.Effect<ModelCapabilityProfile, ModelRoutingServiceError>;
  readonly putUserPreferenceProfile: (
    input: PutUserModelPreferenceProfileInput,
  ) => Effect.Effect<UserModelPreferenceProfile, ModelRoutingServiceError>;
  readonly recommend: (
    request: ModelRoutingRequest,
  ) => Effect.Effect<ModelRecommendation, ProjectionRepositoryError>;
  readonly select: (
    input: SelectModelInput,
  ) => Effect.Effect<ModelSelectionReceipt, ModelRoutingServiceError>;
  readonly recordOutcome: (
    outcome: ModelOutcomeInput,
  ) => Effect.Effect<ModelTelemetryAggregate, ModelRoutingServiceError>;
}

export class ModelRoutingService extends ServiceMap.Service<
  ModelRoutingService,
  ModelRoutingServiceShape
>()("synara/supervised/modelRouting/ModelRoutingService") {}

const preferenceModelIds = (profile: UserModelPreferenceProfile): readonly string[] => [
  ...Object.keys(profile.ratings),
  ...profile.relativePreferences.flatMap((preference) => [
    preference.preferredModelId,
    preference.overModelId,
  ]),
  ...Object.values(profile.preferredFor).flat(),
  ...Object.values(profile.avoidFor).flat(),
  ...Object.values(profile.defaultModels).flatMap((id) => (id === undefined ? [] : [id])),
  ...Object.values(profile.fallbackChains).flat(),
];

export const ModelRoutingServiceLive = Layer.effect(
  ModelRoutingService,
  Effect.gen(function* () {
    const repository = yield* SupervisedGovernanceRepository;

    const getState: ModelRoutingServiceShape["getState"] = (userId) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getModelRoutingState();
        return {
          routingRevision: snapshot.revision,
          capabilityProfiles: snapshot.modelCapabilityProfiles,
          preferenceProfile:
            snapshot.userModelPreferenceProfiles.find((profile) => profile.userId === userId) ??
            null,
          telemetryAggregates: snapshot.modelTelemetryAggregates,
        };
      });

    const putCapabilityProfile: ModelRoutingServiceShape["putCapabilityProfile"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getModelRoutingState();
        const sameId = snapshot.modelCapabilityProfiles.find(
          (profile) => profile.id === input.profile.id,
        );
        const sameModelVersion = snapshot.modelCapabilityProfiles.find(
          (profile) =>
            profile.provider === input.profile.provider &&
            profile.model === input.profile.model &&
            profile.version === input.profile.version,
        );
        const current = sameId ?? sameModelVersion;
        if (
          (current?.revision ?? null) !== input.expectedRevision ||
          (current && current.id !== input.profile.id) ||
          (sameId &&
            (sameId.provider !== input.profile.provider ||
              sameId.model !== input.profile.model ||
              sameId.version !== input.profile.version)) ||
          (current ? input.profile.revision !== current.revision + 1 : input.profile.revision !== 0)
        ) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "capability_profile_conflict",
              `Capability profile '${input.profile.id}' does not match expected revision ${input.expectedRevision}.`,
            ),
          );
        }
        yield* repository.putModelCapabilityProfile({
          profile: input.profile,
          expectedRevision: snapshot.revision,
        });
        return input.profile;
      });

    const putUserPreferenceProfile: ModelRoutingServiceShape["putUserPreferenceProfile"] = (
      input,
    ) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getModelRoutingState();
        const sameId = snapshot.userModelPreferenceProfiles.find(
          (profile) => profile.id === input.profile.id,
        );
        const sameUser = snapshot.userModelPreferenceProfiles.find(
          (profile) => profile.userId === input.profile.userId,
        );
        const current = sameId ?? sameUser;
        if (
          (current?.revision ?? null) !== input.expectedRevision ||
          (current && current.id !== input.profile.id) ||
          (sameId && sameId.userId !== input.profile.userId) ||
          (current ? input.profile.revision !== current.revision + 1 : input.profile.revision !== 0)
        ) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "preference_profile_conflict",
              `Preference profile '${input.profile.id}' does not match expected revision ${input.expectedRevision}.`,
            ),
          );
        }
        const knownIds = new Set<string>(
          snapshot.modelCapabilityProfiles.map((profile) => profile.id),
        );
        const unknownId = preferenceModelIds(input.profile).find((id) => !knownIds.has(id));
        if (unknownId) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "unknown_capability_profile",
              `Preference profile '${input.profile.id}' refers to unknown model '${unknownId}'.`,
            ),
          );
        }
        yield* repository.putUserModelPreferenceProfile({
          profile: input.profile,
          expectedRevision: snapshot.revision,
        });
        return input.profile;
      });

    const recommend: ModelRoutingServiceShape["recommend"] = (request) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getModelRoutingState();
        const preference = snapshot.userModelPreferenceProfiles.find(
          (profile) => profile.userId === request.userId,
        );
        return recommendModels(
          snapshot.modelCapabilityProfiles,
          preference,
          snapshot.modelTelemetryAggregates,
          { ...request, routingRevision: snapshot.revision },
        );
      });

    const select: ModelRoutingServiceShape["select"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
        if (input.request.routingRevision !== snapshot.revision) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "routing_revision_conflict",
              `Model routing revision conflict: expected ${input.request.routingRevision}, current ${snapshot.revision}.`,
            ),
          );
        }
        const actorSeat = snapshot.agentSeats.find((seat) => seat.id === input.request.actorSeatId);
        const authorityReceipt = snapshot.authorityReceipts.find(
          (receipt) => receipt.id === actorSeat?.authorityReceiptId,
        );
        if (
          !actorSeat ||
          !["ready", "active"].includes(actorSeat.lifecycleState) ||
          actorSeat.workspaceId !== input.request.workspaceId ||
          !authorityReceipt ||
          authorityReceipt.actorSeatId !== actorSeat.id ||
          authorityReceipt.revokedAt !== null ||
          (authorityReceipt.expiresAt !== null &&
            authorityReceipt.expiresAt <= input.request.createdAt) ||
          !authorityReceipt.workspaceScopes.includes(input.request.workspaceId) ||
          (input.request.roomId !== null &&
            (!actorSeat.roomIds.includes(input.request.roomId) ||
              !authorityReceipt.roomScopes.includes(input.request.roomId)))
        ) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "routing_authority_denied",
              "The acting AgentSeat has no effective authority for this model selection scope.",
            ),
          );
        }
        const preference = snapshot.userModelPreferenceProfiles.find(
          (profile) => profile.userId === input.request.userId,
        );
        const canonicalRequest = { ...input.request, routingRevision: snapshot.revision };
        const recommendation = recommendModels(
          snapshot.modelCapabilityProfiles,
          preference,
          snapshot.modelTelemetryAggregates,
          canonicalRequest,
        );
        if (recommendation.selectedModelId === null) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "no_valid_candidate",
              "No model satisfies the hard routing constraints.",
            ),
          );
        }
        const receipt = createModelSelectionReceipt(
          input.receiptId,
          recommendation,
          canonicalRequest,
        );
        yield* repository.appendModelSelectionReceipt({
          receipt,
          expectedRevision: snapshot.revision,
        });
        return receipt;
      });

    const recordOutcome: ModelRoutingServiceShape["recordOutcome"] = (outcome) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getModelRoutingState();
        if (
          !snapshot.modelCapabilityProfiles.some((profile) => profile.id === outcome.modelProfileId)
        ) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "unknown_capability_profile",
              `Cannot record telemetry for unknown model '${outcome.modelProfileId}'.`,
            ),
          );
        }
        const current = snapshot.modelTelemetryAggregates.find(
          (aggregate) =>
            aggregate.modelProfileId === outcome.modelProfileId &&
            aggregate.category === outcome.category,
        );
        const aggregate = aggregateModelOutcome(current, outcome);
        yield* repository.putModelTelemetryAggregate({
          aggregate,
          expectedRevision: snapshot.revision,
        });
        return aggregate;
      });

    return ModelRoutingService.of({
      getState,
      putCapabilityProfile,
      putUserPreferenceProfile,
      recommend,
      select,
      recordOutcome,
    });
  }),
);
