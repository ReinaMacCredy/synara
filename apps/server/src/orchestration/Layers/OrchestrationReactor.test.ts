import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../Services/ProviderRuntimeIngestion.ts";
import { OrchestrationReactor } from "../Services/OrchestrationReactor.ts";
import { OrchestratorMailbox } from "../Services/OrchestratorMailbox.ts";
import { OrchestratorMonitor } from "../Services/OrchestratorMonitor.ts";
import { makeOrchestrationReactor } from "./OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("starts runtime observers before provider command dispatch can begin", async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    let reconciledOpenTurns = 0;

    runtime = ManagedRuntime.make(
      Layer.effect(OrchestrationReactor, makeOrchestrationReactor).pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestratorMailbox, {
            start: Effect.acquireRelease(
              Effect.sync(() => {
                started.push("orchestrator-mailbox");
              }),
              () => Effect.sync(() => stopped.push("orchestrator-mailbox")),
            ),
            reconcileRoot: () =>
              Effect.succeed({
                rootsVisited: 1,
                messagesDelivered: 0,
                messagesExpired: 0,
                messagesFailed: 0,
                responsesCorrelated: 0,
              }),
            reconcileAll: Effect.succeed({
              rootsVisited: 0,
              messagesDelivered: 0,
              messagesExpired: 0,
              messagesFailed: 0,
              responsesCorrelated: 0,
            }),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(OrchestratorMonitor, {
            start: Effect.acquireRelease(
              Effect.sync(() => {
                started.push("orchestrator-monitor");
              }),
              () => Effect.sync(() => stopped.push("orchestrator-monitor")),
            ),
            reconcileRoot: () =>
              Effect.succeed({
                rootsVisited: 1,
                monitorsFired: 0,
                monitorsExpired: 0,
                monitorsCancelled: 0,
                wakesDispatched: 0,
              }),
            reconcileEvent: () =>
              Effect.succeed({
                rootsVisited: 0,
                monitorsFired: 0,
                monitorsExpired: 0,
                monitorsCancelled: 0,
                wakesDispatched: 0,
              }),
            reconcileAll: Effect.succeed({
              rootsVisited: 0,
              monitorsFired: 0,
              monitorsExpired: 0,
              monitorsCancelled: 0,
              wakesDispatched: 0,
            }),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderRuntimeIngestionService, {
            start: Effect.acquireRelease(
              Effect.sync(() => {
                started.push("provider-runtime-ingestion");
              }),
              () => Effect.sync(() => stopped.push("provider-runtime-ingestion")),
            ),
            drain: Effect.void,
            reconcileSettledOpenTurns: Effect.sync(() => {
              reconciledOpenTurns += 1;
            }),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderCommandReactor, {
            start: Effect.acquireRelease(
              Effect.sync(() => {
                started.push("provider-command-reactor");
              }),
              () => Effect.sync(() => stopped.push("provider-command-reactor")),
            ),
            drain: Effect.void,
            listBlockingDeliveries: () => Effect.succeed([]),
            reconcileDelivery: () => Effect.succeed(null),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(CheckpointReactor, {
            start: Effect.acquireRelease(
              Effect.sync(() => {
                started.push("checkpoint-reactor");
              }),
              () => Effect.sync(() => stopped.push("checkpoint-reactor")),
            ),
            drain: Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(OrchestrationReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));
    await Effect.runPromise(reactor.reconcileSettledOpenTurns);

    expect(started).toEqual([
      "checkpoint-reactor",
      "provider-runtime-ingestion",
      "orchestrator-mailbox",
      "orchestrator-monitor",
      "provider-command-reactor",
    ]);
    expect(reconciledOpenTurns).toBe(1);

    await Effect.runPromise(Scope.close(scope, Exit.void));
    expect(stopped).toEqual([
      "provider-command-reactor",
      "orchestrator-monitor",
      "orchestrator-mailbox",
      "provider-runtime-ingestion",
      "checkpoint-reactor",
    ]);
  });
});
