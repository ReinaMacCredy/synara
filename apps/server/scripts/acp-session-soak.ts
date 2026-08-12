import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Fiber, Stream } from "effect";

import { AcpSessionRuntime } from "../src/provider/acp/AcpSessionRuntime.ts";

interface Sample {
  readonly elapsedMs: number;
  readonly cycle: number;
  readonly promptCount: number;
  readonly hostRssBytes: number;
  readonly hostHeapUsedBytes: number;
  readonly childRssBytes: number | null;
  readonly eventQueueDepth: number;
  readonly incomingChunkQueueDepth: number;
  readonly outgoingChunkQueueDepth: number;
  readonly sessionUpdatesEnqueuedCount: number;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function positiveNumber(name: string, fallback: number): number {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be positive`);
  return value;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function processRssBytes(processId: number): number | null {
  const result = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(processId)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) return null;
  const kibibytes = Number(new TextDecoder().decode(result.stdout).trim());
  return Number.isFinite(kibibytes) ? kibibytes * 1_024 : null;
}

async function waitForExit(processId: number, timeoutMs = 10_000): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      process.kill(processId, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
      throw error;
    }
    await sleep(50);
  }
  return false;
}

const durationMs = positiveNumber("duration-seconds", 2 * 60 * 60) * 1_000;
const cycleMs = Math.min(durationMs, positiveNumber("cycle-seconds", 5 * 60) * 1_000);
const sampleIntervalMs = positiveNumber("sample-seconds", 10) * 1_000;
const promptIntervalMs = positiveNumber("prompt-interval-ms", 250);
const agentPath = path.resolve(
  argument("agent") ?? path.join(import.meta.dir, "acp-mock-agent.ts"),
);
const outputPath = argument("output");
const exitLogPath = path.resolve(
  argument("exit-log") ?? path.join(process.cwd(), ".veylen-acp-soak", "agent-exits.log"),
);

if (!existsSync(agentPath)) throw new Error(`ACP soak agent not found: ${agentPath}`);
await mkdir(path.dirname(exitLogPath), { recursive: true });
await rm(exitLogPath, { force: true });

const startedAt = performance.now();
const samples: Sample[] = [];
const processIds: number[] = [];
const exitedProcessIds: number[] = [];
let promptCount = 0;
let cycle = 0;
let nextSampleAt = startedAt;

while (performance.now() - startedAt < durationMs) {
  cycle += 1;
  const cycleDeadline = Math.min(startedAt + durationMs, performance.now() + cycleMs);
  let cycleProcessId = -1;

  cycleProcessId = await Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime;
      yield* runtime.start();
      const initialDiagnostics = yield* runtime.diagnostics;
      const eventsFiber = yield* Stream.runDrain(runtime.getEvents()).pipe(Effect.forkScoped);

      while (performance.now() < cycleDeadline) {
        if (promptCount > 0 && promptCount % 20 === 0) yield* runtime.cancel;
        yield* runtime.prompt({
          prompt: [{ type: "text", text: `packaged ACP soak turn ${promptCount}` }],
        });
        promptCount += 1;

        if (performance.now() >= nextSampleAt) {
          const diagnostics = yield* runtime.diagnostics;
          const memory = process.memoryUsage();
          samples.push({
            elapsedMs: performance.now() - startedAt,
            cycle,
            promptCount,
            hostRssBytes: memory.rss,
            hostHeapUsedBytes: memory.heapUsed,
            childRssBytes: processRssBytes(diagnostics.processId),
            eventQueueDepth: diagnostics.eventQueueDepth,
            incomingChunkQueueDepth: diagnostics.incomingChunkQueueDepth,
            outgoingChunkQueueDepth: diagnostics.outgoingChunkQueueDepth,
            sessionUpdatesEnqueuedCount: diagnostics.sessionUpdatesEnqueuedCount,
          });
          nextSampleAt += sampleIntervalMs;
        }
        yield* Effect.sleep(promptIntervalMs);
      }

      yield* Fiber.interrupt(eventsFiber);
      return initialDiagnostics.processId;
    }).pipe(
      Effect.provide(
        AcpSessionRuntime.layer({
          spawn: {
            command: process.execPath,
            args: [agentPath],
            env: {
              ...process.env,
              VEYLEN_ACP_EXIT_LOG_PATH: exitLogPath,
              VEYLEN_ACP_SUPPORT_SESSION_RESUME: "1",
            },
          },
          cwd: process.cwd(),
          ...(cycle % 2 === 0 ? { resumeSessionId: "mock-session-1" } : {}),
          clientInfo: { name: "veylen-packaged-soak", version: "0.7.2" },
          authMethodId: "test",
        }),
      ),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
  );

  processIds.push(cycleProcessId);
  if (await waitForExit(cycleProcessId)) exitedProcessIds.push(cycleProcessId);
}

const steadySamples = samples.slice(Math.floor(samples.length * 0.2));
const hostRssMonotonic = steadySamples.every(
  (sample, index) => index === 0 || sample.hostRssBytes >= steadySamples[index - 1]!.hostRssBytes,
);
const childRssValues = steadySamples.flatMap((sample) =>
  sample.childRssBytes === null ? [] : [sample.childRssBytes],
);
const childRssMonotonic = childRssValues.every(
  (value, index) => index === 0 || value >= childRssValues[index - 1]!,
);
const retainedHostGrowthBytes =
  steadySamples.length > 1
    ? steadySamples.at(-1)!.hostRssBytes - steadySamples[0]!.hostRssBytes
    : 0;
const retainedChildGrowthBytes =
  childRssValues.length > 1 ? childRssValues.at(-1)! - childRssValues[0]! : 0;
const maxQueueDepths = {
  event: Math.max(0, ...samples.map((sample) => sample.eventQueueDepth)),
  incomingChunk: Math.max(0, ...samples.map((sample) => sample.incomingChunkQueueDepth)),
  outgoingChunk: Math.max(0, ...samples.map((sample) => sample.outgoingChunkQueueDepth)),
};
const exitLog = existsSync(exitLogPath) ? readFileSync(exitLogPath, "utf8").trim().split("\n") : [];
const leakThresholdBytes = 32 * 1024 * 1024;
const result = {
  createdAt: new Date().toISOString(),
  workload: {
    durationMs: performance.now() - startedAt,
    cycleMs,
    sampleIntervalMs,
    promptIntervalMs,
    promptCount,
    cycles: cycle,
    agentPath,
    packagedEntry: import.meta.path,
  },
  processProof: {
    processIds,
    exitedProcessIds,
    allExited: exitedProcessIds.length === processIds.length,
    exitLog,
  },
  memory: {
    hostRssMonotonic,
    childRssMonotonic,
    retainedHostGrowthBytes,
    retainedChildGrowthBytes,
    leakThresholdBytes,
    monotonicallyRetainedLeak:
      (hostRssMonotonic && retainedHostGrowthBytes > leakThresholdBytes) ||
      (childRssMonotonic && retainedChildGrowthBytes > leakThresholdBytes),
  },
  maxQueueDepths,
  samples,
};

const serialized = `${JSON.stringify(result, null, 2)}\n`;
if (outputPath) await Bun.write(outputPath, serialized);
else process.stdout.write(serialized);

if (!result.processProof.allExited || result.memory.monotonicallyRetainedLeak) process.exitCode = 1;
