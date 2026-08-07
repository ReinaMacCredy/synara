import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import type { BlobReference, ContextRecord, ContextWorkspace } from "@synara/contracts";

export class ContextRevisionConflictError extends Error {
  readonly code = "context.revision_conflict";

  constructor(
    readonly workspaceId: string,
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Context Workspace '${workspaceId}' expected revision ${expectedRevision}, current revision is ${currentRevision}.`,
    );
  }
}

export interface ContextAppendResult {
  readonly workspace: ContextWorkspace;
  readonly record: ContextRecord;
}

export function appendContextRecord(
  workspace: ContextWorkspace,
  record: ContextRecord,
  expectedRevision: number,
): ContextAppendResult {
  if (workspace.revision !== expectedRevision) {
    throw new ContextRevisionConflictError(workspace.id, expectedRevision, workspace.revision);
  }
  if (record.workspaceId !== workspace.id) {
    throw new Error(`Context record '${record.id}' belongs to a different workspace.`);
  }
  if (record.inlineText === null && record.blob === null) {
    throw new Error(`Context record '${record.id}' must contain inline text or a blob.`);
  }
  return {
    record,
    workspace: {
      ...workspace,
      revision: workspace.revision + 1,
      updatedAt: record.updatedAt,
    },
  };
}

export interface ContextBlobStore {
  readonly put: (bytes: Uint8Array, mediaType: string, createdAt: string) => Promise<BlobReference>;
  readonly read: (reference: BlobReference) => Promise<Uint8Array>;
  readonly verify: (reference: BlobReference) => Promise<boolean>;
}

const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function createContextBlobStore(rootDirectory: string): ContextBlobStore {
  const root = path.resolve(rootDirectory);
  const blobPath = (hash: string) => {
    const digestPart = hash.startsWith("sha256:") ? hash.slice("sha256:".length) : "";
    if (!/^[a-f0-9]{64}$/.test(digestPart)) {
      throw new Error("Invalid content-addressed blob hash.");
    }
    return path.join(root, digestPart.slice(0, 2), digestPart.slice(2));
  };

  return {
    put: async (bytes, mediaType, createdAt) => {
      const hash = digest(bytes);
      const target = blobPath(hash);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      try {
        const existing = await stat(target);
        if (existing.size !== bytes.byteLength) {
          throw new Error(`Existing blob '${hash}' has an unexpected size.`);
        }
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
          throw error;
        }
        const temporary = path.join(path.dirname(target), `.tmp-${randomUUID()}`);
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(bytes);
          await handle.sync();
        } finally {
          await handle.close();
        }
        try {
          await rename(temporary, target);
        } catch (renameError) {
          await unlink(temporary).catch(() => undefined);
          if (!(renameError instanceof Error) || !("code" in renameError) || renameError.code !== "EEXIST") {
            throw renameError;
          }
        }
      }
      return {
        hash: hash as BlobReference["hash"],
        mediaType,
        sizeBytes: bytes.byteLength,
        createdAt,
      };
    },
    read: async (reference) => {
      const bytes = await readFile(blobPath(reference.hash));
      if (bytes.byteLength !== reference.sizeBytes || digest(bytes) !== reference.hash) {
        throw new Error(`Context blob '${reference.hash}' failed integrity verification.`);
      }
      return bytes;
    },
    verify: async (reference) => {
      try {
        const bytes = await readFile(blobPath(reference.hash));
        return bytes.byteLength === reference.sizeBytes && digest(bytes) === reference.hash;
      } catch {
        return false;
      }
    },
  };
}
