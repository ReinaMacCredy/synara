import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyLegacyEnvironmentAliases,
  resolveVeylenHomeDirectory,
} from "./veylenHome";

describe("veylenHome", () => {
  it("prefers Veylen configuration while accepting the legacy Synara variable", () => {
    expect(
      resolveVeylenHomeDirectory({
        env: { VEYLEN_HOME: "/new/veylen", SYNARA_HOME: "/legacy/synara" },
      }),
    ).toBe("/new/veylen");
    expect(resolveVeylenHomeDirectory({ env: { SYNARA_HOME: "/legacy/synara" } })).toBe(
      "/legacy/synara",
    );
  });

  it("uses an existing legacy home only when the Veylen home does not exist", () => {
    const homeDirectory = FS.mkdtempSync(Path.join(OS.tmpdir(), "veylen-home-"));
    try {
      const legacyHome = Path.join(homeDirectory, ".synara");
      const veylenHome = Path.join(homeDirectory, ".veylen");
      FS.mkdirSync(legacyHome);
      expect(resolveVeylenHomeDirectory({ env: {}, homeDirectory })).toBe(legacyHome);
      FS.mkdirSync(veylenHome);
      expect(resolveVeylenHomeDirectory({ env: {}, homeDirectory })).toBe(veylenHome);
    } finally {
      FS.rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it("copies legacy environment values without replacing Veylen values", () => {
    const env = {
      SYNARA_PORT_OFFSET: "10",
      SYNARA_HOME: "/legacy",
      VEYLEN_HOME: "/current",
    };
    applyLegacyEnvironmentAliases(env);
    expect(env).toMatchObject({ VEYLEN_PORT_OFFSET: "10", VEYLEN_HOME: "/current" });
  });
});
