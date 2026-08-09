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
  ...Object.values(profile.defaultModels).filter((id): id is string => id !== undefined),
  ...Object.values(profile.fallbackChains).flat(),
];

export const ModelRoutingServiceLive = Layer.effect(
  ModelRoutingService,
  Effect.gen(function* () {
    const repository = yield* SupervisedGovernanceRepository;

    const getState: ModelRoutingServiceShape["getState"] = (userId) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
        return {
          routingRevision: snapshot.revision,
          capabilityProfiles: snapshot.modelCapabilityProfiles,
          preferenceProfile:
            snapshot.userModelPreferenceProfiles.find((profile) => profile.userId === userId) ?? null,
          telemetryAggregates: snapshot.modelTelemetryAggregates,
        };
      });

    const putCapabilityProfile: ModelRoutingServiceShape["putCapabilityProfile"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
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
          (current && input.profile.revision !== current.revision + 1)
        ) {
          return yield* Effect.fail(
            new ModelRoutingDomainError(
              "capability_profile_conflict",
              `Capability profile '${input.profile.id}' does not match expected revision ${input.expectedRevision}.`,
            ),
          );
        }
        yield* repository.replaceSnapshot({
          ...snapshot,
          modelCapabilityProfiles: [
            ...snapshot.modelCapabilityProfiles.filter((profile) => profile.id !== input.profile.id),
            input.profile,
          ],
          updatedAt: input.profile.updatedAt,
        });
        return input.profile;
      });

    const putUserPreferenceProfile: ModelRoutingServiceShape["putUserPreferenceProfile"] = (
      input,
    ) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
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
          (current && input.profile.revision !== current.revision + 1)
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
        yield* repository.replaceSnapshot({
          ...snapshot,
          userModelPreferenceProfiles: [
            ...snapshot.userModelPreferenceProfiles.filter(
              (profile) => profile.id !== input.profile.id,
            ),
            input.profile,
          ],
          updatedAt: input.profile.updatedAt,
        });
        return input.profile;
      });

    const recommend: ModelRoutingServiceShape["recommend"] = (request) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
        const preference = snapshot.userModelPreferenceProfiles.find(
          (profile) => profile.userId === request.userId,
        );
        return recommendModels(
          snapshot.modelCapabilityProfiles,
          preference,
          snapshot.modelTelemetryAggregates,
          request,
        );
      });

    const select: ModelRoutingServiceShape["select"] = (input) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
        const preference = snapshot.userModelPreferenceProfiles.find(
          (profile) => profile.userId === input.request.userId,
        );
        const recommendation = recommendModels(
          snapshot.modelCapabilityProfiles,
          preference,
          snapshot.modelTelemetryAggregates,
          input.request,
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
          input.request,
        );
        yield* repository.replaceSnapshot({
          ...snapshot,
          modelSelectionReceipts: [receipt, ...snapshot.modelSelectionReceipts],
          updatedAt: input.request.createdAt,
        });
        return receipt;
      });

    const recordOutcome: ModelRoutingServiceShape["recordOutcome"] = (outcome) =>
      Effect.gen(function* () {
        const snapshot = yield* repository.getSnapshot();
        if (
          !snapshot.modelCapabilityProfiles.some(
            (profile) => profile.id === outcome.modelProfileId,
          )
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
        yield* repository.replaceSnapshot({
          ...snapshot,
          modelTelemetryAggregates: [
            ...snapshot.modelTelemetryAggregates.filter(
              (candidate) => candidate.id !== aggregate.id,
            ),
            aggregate,
          ],
          updatedAt: outcome.completedAt,
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
