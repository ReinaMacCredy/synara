import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Data } from "effect";

import { resolveRealPathForCreateWithinRoot } from "../../workspace/realPathContainment.ts";

export class WriterClaimPathError extends Data.TaggedError("WriterClaimPathError")<{
  readonly workspaceRoot: string;
  readonly requestedPath: string;
  readonly detail: string;
}> {}

interface WriterClaimPathView {
  readonly workspaceRoot: string;
  readonly normalizedPathPrefix: string;
}

interface WriterClaimConflictView extends WriterClaimPathView {
  readonly mode: "read" | "write";
  readonly threadId: string;
}

export const pathContains = (parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

export const canonicalizeWriterClaimScope = async (input: {
  readonly workspaceRoot: string;
  readonly pathPrefix: string;
}): Promise<{ readonly workspaceRoot: string; readonly normalizedPathPrefix: string }> => {
  const lexicalRoot = path.resolve(input.workspaceRoot);
  const requestedPath = path.isAbsolute(input.pathPrefix)
    ? path.resolve(input.pathPrefix)
    : path.resolve(lexicalRoot, input.pathPrefix);
  let realRoot: string;
  let realPrefix: string | null;
  try {
    realRoot = await fs.realpath(lexicalRoot);
    realPrefix = await resolveRealPathForCreateWithinRoot(lexicalRoot, requestedPath);
  } catch (cause) {
    throw new WriterClaimPathError({
      workspaceRoot: lexicalRoot,
      requestedPath,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (realPrefix === null || !pathContains(realRoot, realPrefix)) {
    throw new WriterClaimPathError({
      workspaceRoot: realRoot,
      requestedPath,
      detail: "The requested path is outside the canonical workspace root.",
    });
  }
  return { workspaceRoot: realRoot, normalizedPathPrefix: realPrefix };
};

export const writerClaimsOverlap = (
  left: WriterClaimPathView,
  right: WriterClaimPathView,
): boolean =>
  left.workspaceRoot === right.workspaceRoot &&
  (pathContains(left.normalizedPathPrefix, right.normalizedPathPrefix) ||
    pathContains(right.normalizedPathPrefix, left.normalizedPathPrefix));

export const writerClaimsConflict = (
  left: WriterClaimConflictView,
  right: WriterClaimConflictView,
): boolean =>
  left.threadId !== right.threadId &&
  (left.mode === "write" || right.mode === "write") &&
  writerClaimsOverlap(left, right);
