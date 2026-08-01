import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WriterClaimPathError,
  canonicalizeWriterClaimScope,
  writerClaimsConflict,
} from "./writerClaims.ts";

describe("writer claims", () => {
  it("uses path segments rather than vulnerable string prefixes", () => {
    const base = {
      workspaceRoot: "/repo",
      mode: "write" as const,
    };
    expect(
      writerClaimsConflict(
        { ...base, normalizedPathPrefix: "/repo/apps/a", threadId: "a" },
        { ...base, normalizedPathPrefix: "/repo/apps/ab", threadId: "b" },
      ),
    ).toBe(false);
    expect(
      writerClaimsConflict(
        { ...base, normalizedPathPrefix: "/repo/apps/a", threadId: "a" },
        { ...base, normalizedPathPrefix: "/repo/apps/a/src", threadId: "b" },
      ),
    ).toBe(true);
  });

  it("allows concurrent reads and same-thread nested claims", () => {
    const base = { workspaceRoot: "/repo", normalizedPathPrefix: "/repo/apps" };
    expect(
      writerClaimsConflict(
        { ...base, mode: "read", threadId: "a" },
        { ...base, mode: "read", threadId: "b" },
      ),
    ).toBe(false);
    expect(
      writerClaimsConflict(
        { ...base, mode: "write", threadId: "a" },
        { ...base, normalizedPathPrefix: "/repo/apps/web", mode: "write", threadId: "a" },
      ),
    ).toBe(false);
  });

  it("canonicalizes in-root symlinks and rejects symlink escapes", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "synara-writer-claim-"));
    const root = path.join(temp, "workspace");
    const outside = path.join(temp, "outside");
    await fs.mkdir(path.join(root, "real", "src"), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(path.join(root, "real"), path.join(root, "inside-link"));
    await fs.symlink(outside, path.join(root, "escape-link"));
    try {
      const canonical = await canonicalizeWriterClaimScope({
        workspaceRoot: root,
        pathPrefix: "inside-link/src/new-file.ts",
      });
      expect(canonical.normalizedPathPrefix).toBe(
        path.join(await fs.realpath(root), "real", "src", "new-file.ts"),
      );
      await expect(
        canonicalizeWriterClaimScope({
          workspaceRoot: root,
          pathPrefix: "escape-link/file.ts",
        }),
      ).rejects.toBeInstanceOf(WriterClaimPathError);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});
