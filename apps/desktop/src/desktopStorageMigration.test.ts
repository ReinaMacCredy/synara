import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  acknowledgeVeylenStorageSnapshot,
  readVeylenStorageSnapshot,
  saveVeylenStorageSnapshot,
  VEYLEN_STORAGE_SNAPSHOT_MAX_BYTES,
  validateVeylenStorageSnapshot,
} from "./desktopStorageMigration";

const snapshot = (exportedAt = "2026-07-09T00:00:00.000Z") => ({
  version: 1 as const,
  exportedAt,
  entries: {
    "veylen:theme": "dark",
    "veylen.openUsage.enabled": "true",
  },
});

describe("desktopStorageMigration", () => {
  it("round-trips atomically and acknowledges the snapshot", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "veylen-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      await expect(saveVeylenStorageSnapshot(target, snapshot())).resolves.toBe(true);
      expect(readVeylenStorageSnapshot(target)).toEqual(snapshot());
      expect(FS.readdirSync(directory)).toEqual(["snapshot.json"]);

      await acknowledgeVeylenStorageSnapshot(target);
      expect(readVeylenStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed, disallowed, and oversized snapshots", () => {
    expect(validateVeylenStorageSnapshot({ version: 1 })).toBeNull();
    expect(
      validateVeylenStorageSnapshot({
        ...snapshot(),
        entries: { "foreign:theme": "dark" },
      }),
    ).toBeNull();
    expect(
      validateVeylenStorageSnapshot({
        ...snapshot(),
        entries: { "veylen:large": "x".repeat(VEYLEN_STORAGE_SNAPSHOT_MAX_BYTES) },
      }),
    ).toBeNull();
  });

  it("accepts renderer snapshots containing large composer drafts", () => {
    const largeDraft = "x".repeat(2 * 1024 * 1024);

    expect(
      validateVeylenStorageSnapshot({
        ...snapshot(),
        entries: { "veylen:composer-drafts:v1": largeDraft },
      })?.entries["veylen:composer-drafts:v1"],
    ).toBe(largeDraft);
  });

  it("accepts legacy Synara keys for the Veylen import bridge", () => {
    expect(
      validateVeylenStorageSnapshot({
        ...snapshot(),
        entries: { "synara:theme": "dark", "synara.openUsage.enabled": "true" },
      }),
    ).not.toBeNull();
  });

  it("does not replace a newer snapshot with an older export", async () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "veylen-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      await saveVeylenStorageSnapshot(target, snapshot("2026-07-09T01:00:00.000Z"));
      await expect(
        saveVeylenStorageSnapshot(target, snapshot("2026-07-09T00:00:00.000Z")),
      ).resolves.toBe(false);
      expect(readVeylenStorageSnapshot(target)?.exportedAt).toBe("2026-07-09T01:00:00.000Z");
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("treats missing and malformed files as absent", () => {
    const directory = FS.mkdtempSync(Path.join(OS.tmpdir(), "veylen-storage-migration-"));
    const target = Path.join(directory, "snapshot.json");
    try {
      expect(readVeylenStorageSnapshot(target)).toBeNull();
      FS.writeFileSync(target, "not json");
      expect(readVeylenStorageSnapshot(target)).toBeNull();
    } finally {
      FS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
