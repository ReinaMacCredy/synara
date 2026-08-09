import type {
  ControlPlaneEvent,
  DeadLetter,
  DeliveryCursor,
  DerivedSignal,
  EventSchema,
  Evidence,
  GetSupervisedRuntimeInput,
  MetricSample,
  ModelSessionTrace,
  PluginInstallation,
  PluginHealth,
  RlmEpisode,
  Run,
  RunPolicy,
  SubscriptionDefinition,
  SubscriptionDelivery,
  SubscriptionEvaluationState,
  SupervisedActor,
  SupervisedDomainEvent,
  SupervisedRuntimeHealth,
  SupervisedRuntimeSnapshot,
} from "@synara/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export interface ClaimSupervisedDeliveriesInput {
  readonly workerId: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
  readonly limit: number;
}

export interface SupervisedRuntimeAuditInput {
  readonly action: string;
  readonly actor: SupervisedActor;
  readonly targetKind: string;
  readonly targetId: string;
  readonly outcome: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

export interface RlmReconciliationState {
  readonly runs: ReadonlyArray<Run>;
  readonly runPolicies: ReadonlyArray<RunPolicy>;
  readonly rlmEpisodes: ReadonlyArray<RlmEpisode>;
  readonly modelSessions: ReadonlyArray<ModelSessionTrace>;
  readonly evidence: ReadonlyArray<Evidence>;
  readonly activePluginCount: number;
  readonly activeSubscriptionCount: number;
}

export interface SupervisedRuntimeRepositoryShape {
  readonly applyDomainEvent: (
    event: SupervisedDomainEvent,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getSnapshot: (
    input?: GetSupervisedRuntimeInput,
  ) => Effect.Effect<SupervisedRuntimeSnapshot, ProjectionRepositoryError>;
  readonly getDaemonSnapshot: () => Effect.Effect<
    SupervisedRuntimeSnapshot,
    ProjectionRepositoryError
  >;
  readonly getRlmReconciliationState: () => Effect.Effect<
    RlmReconciliationState,
    ProjectionRepositoryError
  >;
  readonly hasActiveRlmWork: () => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly getIngestionCursor: (
    key: string,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
  readonly putIngestionCursor: (input: {
    readonly key: string;
    readonly sourceSequence: number;
    readonly updatedAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly replaceSnapshot: (
    snapshot: SupervisedRuntimeSnapshot,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly setHealth: (
    health: SupervisedRuntimeHealth,
    snapshotSequence: number,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly appendControlPlaneEvent: (
    event: ControlPlaneEvent,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
  readonly listControlPlaneEvents: (input: {
    readonly afterSequence: number;
    readonly throughSequence?: number;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<ControlPlaneEvent>, ProjectionRepositoryError>;
  readonly upsertEventSchema: (
    schema: EventSchema,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertRunPolicy: (
    policy: RunPolicy,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertSubscription: (
    subscription: SubscriptionDefinition,
    runtime?: {
      readonly nextEligibleAt?: string | null;
      readonly lastTriggeredAt?: string | null;
      readonly lastResetAt?: string | null;
    },
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertCursor: (
    cursor: DeliveryCursor,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getSubscriptionEvaluationState: (
    subscriptionId: SubscriptionDefinition["id"],
  ) => Effect.Effect<SubscriptionEvaluationState, ProjectionRepositoryError>;
  readonly putSubscriptionEvaluationState: (
    subscriptionId: SubscriptionDefinition["id"],
    state: SubscriptionEvaluationState,
    updatedAt: string,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordMetricSample: (
    sample: MetricSample,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertSignal: (
    signal: DerivedSignal,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
    readonly enqueueDelivery: (
      delivery: SubscriptionDelivery,
    ) => Effect.Effect<boolean, ProjectionRepositoryError>;
    readonly countPendingDeliveries: (
      subscriptionId: SubscriptionDefinition["id"],
    ) => Effect.Effect<number, ProjectionRepositoryError>;
    readonly countDeliveredSince: (input: {
      readonly subscriptionId: SubscriptionDefinition["id"];
      readonly since: string;
    }) => Effect.Effect<number, ProjectionRepositoryError>;
    readonly claimDeliveries: (
    input: ClaimSupervisedDeliveriesInput,
  ) => Effect.Effect<ReadonlyArray<SubscriptionDelivery>, ProjectionRepositoryError>;
  readonly updateDelivery: (
    delivery: SubscriptionDelivery,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly putDeadLetter: (
    deadLetter: DeadLetter,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertPlugin: (
    plugin: PluginInstallation,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly updatePluginHealth: (
    health: PluginHealth,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly appendAudit: (
    input: SupervisedRuntimeAuditInput,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class SupervisedRuntimeRepository extends ServiceMap.Service<
  SupervisedRuntimeRepository,
  SupervisedRuntimeRepositoryShape
>()("synara/persistence/Services/SupervisedRuntimeRepository/SupervisedRuntimeRepository") {}
