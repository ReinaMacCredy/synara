import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";

import type { RunPolicy } from "@synara/contracts";

import { PersistentKernel } from "./KernelRuntime.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const policy = {
  maxKernelMemoryMiB: 128,
  maxKernelOutputBytes: 64 * 1024,
  maxWallTimeMs: 2_000,
} as RunPolicy;

async function directory() {
  const result = await mkdtemp(path.join(os.tmpdir(), "synara-kernel-"));
  directories.push(result);
  return result;
}

describe("PersistentKernel", () => {
  it("keeps JavaScript state across bounded executions", async () => {
    const kernel = await PersistentKernel.start({
      language: "javascript",
      workingDirectory: await directory(),
      policy,
      isolation: "trusted-process",
    });
    try {
      assert.equal(
        (await kernel.execute("state.count = (state.count ?? 0) + 1; return state.count;")).result,
        1,
      );
      assert.equal(
        (await kernel.execute("state.count += input; return state.count;", 2)).result,
        3,
      );
    } finally {
      kernel.stop();
    }
  });

  it("keeps Python state across bounded executions", async () => {
    const kernel = await PersistentKernel.start({
      language: "python",
      workingDirectory: await directory(),
      policy,
      isolation: "trusted-process",
      pythonBinary: "/usr/bin/python3",
    });
    try {
      assert.equal(
        (
          await kernel.execute(
            "state['count'] = state.get('count', 0) + 1\nresult = state['count']",
          )
        ).result,
        1,
      );
      assert.equal(
        (await kernel.execute("state['count'] += input\nresult = state['count']", 2)).result,
        3,
      );
    } finally {
      kernel.stop();
    }
  });

  it("fails closed when strong isolation is required but unavailable", async () => {
    if (process.platform === "darwin") return;
    await assert.rejects(() =>
      PersistentKernel.start({
        language: "javascript",
        workingDirectory: directories[0] ?? "/tmp/synara-kernel-unavailable",
        policy,
        isolation: "required",
      }),
    );
  });
});
