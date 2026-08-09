import { Layer } from "effect";

import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore";
import { ManagedAttachmentRepositoryLive } from "../persistence/Layers/ManagedAttachments";
import { SupervisedRuntimeRepositoryLive } from "../persistence/Layers/SupervisedRuntimeRepository";
import { SupervisedGovernanceRepositoryLive } from "../persistence/Layers/SupervisedGovernanceRepository";
import { OrchestrationEngineLive } from "./Layers/OrchestrationEngine";
import { OrchestrationProjectionPipelineLive } from "./Layers/ProjectionPipeline";
import { OrchestrationProjectionSnapshotQueryLive } from "./Layers/ProjectionSnapshotQuery";
import { SupervisedSignalDeliveryLive } from "./Layers/SupervisedSignalDelivery";
import { SupervisedRuntimeDaemonLive } from "./Layers/SupervisedRuntimeDaemon";

export const OrchestrationEventInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationEventStoreLive,
  OrchestrationCommandReceiptRepositoryLive,
  ManagedAttachmentRepositoryLive,
  SupervisedRuntimeRepositoryLive,
  SupervisedGovernanceRepositoryLive,
);

export const OrchestrationProjectionPipelineLayerLive = OrchestrationProjectionPipelineLive.pipe(
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(ManagedAttachmentRepositoryLive),
);

export const OrchestrationInfrastructureLayerLive = Layer.mergeAll(
  OrchestrationProjectionSnapshotQueryLive,
  OrchestrationEventInfrastructureLayerLive,
  OrchestrationProjectionPipelineLayerLive,
);

const OrchestrationEngineLayerLive = OrchestrationEngineLive.pipe(
  Layer.provide(OrchestrationInfrastructureLayerLive),
);

const OrchestrationCoreLayerLive = Layer.mergeAll(
  OrchestrationInfrastructureLayerLive,
  OrchestrationEngineLayerLive,
);

const SupervisedSignalDeliveryLayerLive = SupervisedSignalDeliveryLive.pipe(
  Layer.provideMerge(OrchestrationCoreLayerLive),
);

const SupervisedRuntimeDaemonLayerLive = SupervisedRuntimeDaemonLive.pipe(
  Layer.provideMerge(OrchestrationCoreLayerLive),
  Layer.provideMerge(SupervisedRuntimeRepositoryLive),
  Layer.provideMerge(SupervisedGovernanceRepositoryLive),
  Layer.provideMerge(SupervisedSignalDeliveryLayerLive),
);

export const OrchestrationLayerLive = Layer.mergeAll(
  OrchestrationCoreLayerLive,
  SupervisedSignalDeliveryLayerLive,
  SupervisedRuntimeDaemonLayerLive,
);
