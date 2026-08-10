import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, it } from "@effect/vitest";

import {
  inspectSupervisedPluginPackage,
  loadVerifiedSupervisedPluginPackage,
} from "./PluginPackage.ts";

const hash = `sha256:${"a".repeat(64)}`;

function manifest(entry = "handler.mjs") {
  return {
    pluginId: "plugin-test",
    name: "Test plugin",
    version: "1.0.0",
    manifestVersion: "1",
    description: "Test package",
    handler: { runtime: "javascript", entry, protocolVersion: "1" },
    eventSchemas: [],
    subscriptions: [],
    requestedCapabilities: ["event.read"],
    requestedPayloadFields: [],
    resourceLimits: {
      maxRuntimeMs: 1_000,
      maxMemoryMiB: 64,
      maxOutputBytes: 65_536,
      maxConcurrentHandlers: 1,
      maxQueueDepth: 10,
    },
    provenance: { source: "untrusted", contentHash: hash, signature: null },
  };
}

describe("Supervised plugin package inspection", () => {
  it("resolves a local package and replaces client provenance with a host hash", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "synara-plugin-"));
    try {
      await writeFile(path.join(directory, "synara-plugin.json"), JSON.stringify(manifest()));
      await writeFile(
        path.join(directory, "handler.mjs"),
        "export function handle() { return {}; }",
      );
      const inspection = await inspectSupervisedPluginPackage(directory);
      assert.match(inspection.manifest.provenance.source, /^file:/);
      assert.notEqual(inspection.manifest.provenance.contentHash, hash);
      const verified = await loadVerifiedSupervisedPluginPackage(directory);
      assert.equal(verified.handlerSource, "export function handle() { return {}; }");
      assert.equal(
        verified.inspection.manifest.provenance.contentHash,
        inspection.manifest.provenance.contentHash,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a handler symlink that escapes the package", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "synara-plugin-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "synara-plugin-outside-"));
    try {
      await mkdir(path.join(directory, "nested"));
      await writeFile(
        path.join(directory, "synara-plugin.json"),
        JSON.stringify(manifest("nested/handler.mjs")),
      );
      await writeFile(path.join(outside, "handler.mjs"), "export function handle() { return {}; }");
      await symlink(
        path.join(outside, "handler.mjs"),
        path.join(directory, "nested", "handler.mjs"),
      );
      await assert.rejects(() => inspectSupervisedPluginPackage(directory), /symlink escapes/);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
