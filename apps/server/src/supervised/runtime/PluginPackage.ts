import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  PluginManifest,
  type SupervisedPluginInspection,
} from "@synara/contracts";
import { Schema } from "effect";

const MAX_MANIFEST_BYTES = 1_048_576;
const MAX_HANDLER_BYTES = 8_388_608;

const sha256 = (value: string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as const;

async function readBoundedRegularFile(filePath: string, maxBytes: number): Promise<string> {
  const stat = await lstat(filePath);
  if (!stat.isFile()) throw new Error(`Plugin package file '${filePath}' is not a regular file.`);
  if (stat.size > maxBytes) throw new Error(`Plugin package file '${filePath}' exceeds its size limit.`);
  return readFile(filePath, "utf8");
}

function containedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function loadVerifiedSupervisedPluginPackage(
  requestedDirectory: string,
) {
  const directory = await realpath(requestedDirectory);
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory()) throw new Error("The selected plugin package is not a directory.");

  const manifestPath = path.join(directory, "synara-plugin.json");
  const manifestText = await readBoundedRegularFile(manifestPath, MAX_MANIFEST_BYTES);
  let unknownManifest: unknown;
  try {
    unknownManifest = JSON.parse(manifestText);
  } catch (cause) {
    throw new Error("synara-plugin.json is not valid JSON.", { cause });
  }
  const claimedManifest = Schema.decodeUnknownSync(PluginManifest)(unknownManifest);
  let handlerSource = "";
  if (claimedManifest.handler) {
    const unresolvedEntry = path.resolve(directory, claimedManifest.handler.entry);
    if (!containedPath(directory, unresolvedEntry)) {
      throw new Error("Plugin handler entry escapes the selected package directory.");
    }
    const entry = await realpath(unresolvedEntry);
    if (!containedPath(directory, entry)) {
      throw new Error("Plugin handler symlink escapes the selected package directory.");
    }
    handlerSource = await readBoundedRegularFile(entry, MAX_HANDLER_BYTES);
  }
  const canonicalForHash = {
    ...claimedManifest,
    provenance: { ...claimedManifest.provenance, source: "local", contentHash: "computed" },
  };
  const manifest = Schema.decodeUnknownSync(PluginManifest)({
    ...claimedManifest,
    provenance: {
      ...claimedManifest.provenance,
      source: pathToFileURL(directory).href,
      contentHash: sha256(`${JSON.stringify(canonicalForHash)}\n${handlerSource}`),
    },
  });
  const requestedActionRequests = [
    ...new Set(manifest.subscriptions.flatMap((subscription) => subscription.allowedActionRequests)),
  ];
  const protectedPayloadFields = [
    ...new Set(
      manifest.eventSchemas.flatMap((schema) =>
        Object.entries(schema.fieldClassifications)
          .filter(([, classification]) => classification === "protected")
          .map(([field]) => field),
      ),
    ),
  ].filter((field) => manifest.requestedPayloadFields.includes(field));
  const secretPayloadFields = new Set(
    manifest.eventSchemas.flatMap((schema) =>
      Object.entries(schema.fieldClassifications)
        .filter(([, classification]) => classification === "secret")
        .map(([field]) => field),
    ),
  );
  const warnings = [
    ...(protectedPayloadFields.length > 0
      ? [`Requests ${protectedPayloadFields.length} protected payload field${protectedPayloadFields.length === 1 ? "" : "s"}.`]
      : []),
    ...(manifest.requestedPayloadFields.some((field) => secretPayloadFields.has(field))
      ? ["Secret payload fields are declared but cannot be granted."]
      : []),
    ...(manifest.requestedCapabilities.includes("network.connect")
      ? ["Requests outbound network access; RunPolicy and the host still gate every execution."]
      : []),
    ...(manifest.requestedCapabilities.includes("filesystem.write")
      ? ["Requests filesystem write access; installation does not grant it automatically."]
      : []),
  ];
  return {
    inspection: {
      directory,
      manifest,
      requestedActionRequests,
      protectedPayloadFields,
      warnings,
    } satisfies SupervisedPluginInspection,
    handlerSource,
  };
}

export async function inspectSupervisedPluginPackage(
  requestedDirectory: string,
): Promise<SupervisedPluginInspection> {
  return (await loadVerifiedSupervisedPluginPackage(requestedDirectory)).inspection;
}
