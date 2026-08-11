import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ControlPlaneEvent, PluginInstallation, RunPolicy } from "@veylen/contracts";

import { evaluateRunPolicy, type RunResourceUsage } from "./RunPolicy.ts";
import { PersistentKernel, type KernelExecutionResult } from "./KernelRuntime.ts";

export interface PluginObservationCandidate {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly quality: "exact" | "estimated" | "projected";
  readonly confidence: number;
}

export interface PluginSignalCandidate {
  readonly kind: string;
  readonly measuredValue: number;
  readonly context: Readonly<Record<string, unknown>>;
}

export interface PluginCommandRequest {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PluginHandlerResult {
  readonly observations: ReadonlyArray<PluginObservationCandidate>;
  readonly signals: ReadonlyArray<PluginSignalCandidate>;
  readonly commandRequests: ReadonlyArray<PluginCommandRequest>;
}

export interface PluginKernel {
  readonly execute: (code: string, input: unknown) => Promise<KernelExecutionResult>;
  readonly stop: () => void;
}

export type PluginKernelFactory = (input: {
  readonly language: "javascript" | "python";
  readonly workingDirectory: string;
  readonly policy: RunPolicy;
  readonly allowNetwork: boolean;
  readonly allowFilesystemWrites: boolean;
}) => Promise<PluginKernel>;
export type PluginSourceLoader = (path: string) => Promise<string>;

const defaultKernelFactory: PluginKernelFactory = (input) =>
  PersistentKernel.start({
    ...input,
    isolation: "required",
  });

const emptyResult = (): PluginHandlerResult => ({
  observations: [],
  signals: [],
  commandRequests: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseResult(value: unknown): PluginHandlerResult {
  if (!isRecord(value)) throw new Error("Plugin handler returned a non-object result.");
  const observations = Array.isArray(value.observations) ? value.observations : [];
  const signals = Array.isArray(value.signals) ? value.signals : [];
  const commandRequests = Array.isArray(value.commandRequests) ? value.commandRequests : [];
  if (observations.length > 256 || signals.length > 64 || commandRequests.length > 64) {
    throw new Error("Plugin handler result exceeded bounded output counts.");
  }
  return {
    observations: observations.map((candidate) => {
      if (
        !isRecord(candidate) ||
        typeof candidate.metric !== "string" ||
        typeof candidate.value !== "number" ||
        !Number.isFinite(candidate.value) ||
        typeof candidate.unit !== "string" ||
        !["exact", "estimated", "projected"].includes(String(candidate.quality)) ||
        typeof candidate.confidence !== "number" ||
        candidate.confidence < 0 ||
        candidate.confidence > 1
      ) {
        throw new Error("Plugin observation candidate is invalid.");
      }
      return candidate as unknown as PluginObservationCandidate;
    }),
    signals: signals.map((candidate) => {
      if (
        !isRecord(candidate) ||
        typeof candidate.kind !== "string" ||
        typeof candidate.measuredValue !== "number" ||
        !Number.isFinite(candidate.measuredValue) ||
        !isRecord(candidate.context)
      ) {
        throw new Error("Plugin signal candidate is invalid.");
      }
      return candidate as unknown as PluginSignalCandidate;
    }),
    commandRequests: commandRequests.map((candidate) => {
      if (
        !isRecord(candidate) ||
        typeof candidate.type !== "string" ||
        !isRecord(candidate.payload)
      ) {
        throw new Error("Plugin command request is invalid.");
      }
      return candidate as unknown as PluginCommandRequest;
    }),
  };
}

function filteredEvent(event: ControlPlaneEvent, allowedFields: ReadonlyArray<string>) {
  const payload: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in event.payload) payload[field] = event.payload[field];
  }
  return {
    eventId: event.eventId,
    schemaId: event.schemaId,
    schemaVersion: event.schemaVersion,
    type: event.type,
    scope: event.scope,
    subjectId: event.subjectId,
    eventTime: event.eventTime,
    revision: event.revision,
    payload,
  };
}

async function executeWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Plugin handler exceeded its ${timeoutMs}ms time limit.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class GovernedPluginRuntime {
  private kernel: PluginKernel | null = null;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(
    readonly installation: PluginInstallation,
    private readonly pluginDirectory: string,
    private readonly runPolicy: RunPolicy,
    private readonly usage: RunResourceUsage,
    private readonly kernelFactory: PluginKernelFactory = defaultKernelFactory,
    private readonly sourceLoader: PluginSourceLoader = (entry) => readFile(entry, "utf8"),
    private readonly executionMode: "active" | "observe_only" = "active",
  ) {}

  private assertActive(event: ControlPlaneEvent) {
    if (this.installation.status !== "enabled") {
      throw new Error(`Plugin '${this.installation.pluginId}' is not enabled.`);
    }
    if (this.installation.grant.status !== "active") {
      throw new Error(`Plugin '${this.installation.pluginId}' grant is not active.`);
    }
    if (!this.installation.grant.capabilities.includes("event.read")) {
      throw new Error(`Plugin '${this.installation.pluginId}' cannot read events.`);
    }
    if (Date.now() < this.circuitOpenUntil) {
      throw new Error(`Plugin '${this.installation.pluginId}' circuit breaker is open.`);
    }
    const schemaSupported = this.installation.manifest.eventSchemas.some(
      (schema) =>
        schema.id === event.schemaId &&
        schema.version === event.schemaVersion &&
        schema.status === "active",
    );
    if (!schemaSupported) {
      throw new Error(
        `Plugin '${this.installation.pluginId}' does not support schema '${event.schemaId}@${event.schemaVersion}'.`,
      );
    }
  }

  private validateRequests(result: PluginHandlerResult) {
    if (
      result.observations.length > 0 &&
      !this.installation.grant.capabilities.includes("metric.emit")
    ) {
      throw new Error("Plugin output emitted metrics without metric.emit capability.");
    }
    if (
      result.signals.length > 0 &&
      !this.installation.grant.capabilities.includes("signal.propose")
    ) {
      throw new Error("Plugin output proposed signals without signal.propose capability.");
    }
    for (const request of result.commandRequests) {
      if (!this.installation.grant.capabilities.includes("command.request")) {
        throw new Error("Plugin output requested a command without command.request capability.");
      }
      if (!this.installation.grant.allowedActionRequests.includes(request.type)) {
        throw new Error(`Plugin command request '${request.type}' is outside its grant.`);
      }
      const decision = evaluateRunPolicy(this.runPolicy, this.usage, {
        pluginAction: request.type,
      });
      if (!decision.allowed) throw new Error(decision.reason);
    }
  }

  private async executableSource() {
    const handler = this.installation.manifest.handler;
    if (!handler) return null;
    const root = path.resolve(this.pluginDirectory);
    const entry = path.resolve(root, handler.entry);
    if (entry !== root && !entry.startsWith(`${root}${path.sep}`)) {
      throw new Error("Plugin handler entry escapes the plugin directory.");
    }
    const source = await this.sourceLoader(entry);
    return handler.runtime === "javascript"
      ? `${source}\nreturn await handle(input, state);`
      : `${source}\nresult = handle(input, state)`;
  }

  async handle(event: ControlPlaneEvent): Promise<PluginHandlerResult> {
    this.assertActive(event);
    if (!this.installation.manifest.handler) return emptyResult();
    const handler = this.installation.manifest.handler;
    try {
      this.kernel ??= await this.kernelFactory({
        language: handler.runtime,
        workingDirectory: this.pluginDirectory,
        policy: this.runPolicy,
        allowNetwork:
          this.executionMode === "active" &&
          this.installation.grant.capabilities.includes("network.connect") &&
          this.runPolicy.allowedCapabilities.includes("network.connect"),
        allowFilesystemWrites:
          this.executionMode === "active" &&
          this.installation.grant.capabilities.includes("filesystem.write") &&
          this.runPolicy.allowedCapabilities.includes("filesystem.write"),
      });
      const source = await this.executableSource();
      if (!source) return emptyResult();
      const execution = await executeWithin(
        this.kernel.execute(source, filteredEvent(event, this.installation.grant.payloadFields)),
        Math.min(
          this.runPolicy.maxWallTimeMs,
          this.runPolicy.maxPluginHandlerMs,
          this.installation.manifest.resourceLimits.maxRuntimeMs,
        ),
      );
      const result = parseResult(execution.result);
      this.validateRequests(result);
      this.consecutiveFailures = 0;
      return result;
    } catch (error) {
      this.consecutiveFailures += 1;
      const timedOut = error instanceof Error && error.message.includes(" time limit.");
      if (timedOut || this.consecutiveFailures >= this.runPolicy.circuitBreakerFailureCount) {
        this.circuitOpenUntil = Date.now() + this.runPolicy.circuitBreakerResetMs;
        this.kernel?.stop();
        this.kernel = null;
      }
      throw error;
    }
  }

  stop() {
    this.kernel?.stop();
    this.kernel = null;
  }
}
