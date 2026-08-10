import { describe, expect, it } from "vitest";

import {
  canaryCloneArgs,
  canaryStartArgs,
  parseCanaryArgs,
  resolveCanaryPaths,
  resolveCanaryRef,
} from "./canary";

describe("canary tooling", () => {
  it("keeps managed source and Canary data separate from Stable", () => {
    expect(resolveCanaryPaths({}, "/Users/tester")).toEqual({
      home: "/Users/tester/.veylen-canary",
      source: "/Users/tester/.cache/veylen-canary/source",
      state: "/Users/tester/.veylen-canary/canary-state.json",
      pid: "/Users/tester/.veylen-canary/canary.pid",
      log: "/Users/tester/.veylen-canary/canary.log",
    });
  });

  it("supports explicit path overrides", () => {
    expect(
      resolveCanaryPaths(
        {
          VEYLEN_CANARY_HOME: "/tmp/canary-data",
          VEYLEN_CANARY_SOURCE: "/tmp/canary-source",
        },
        "/Users/tester",
      ),
    ).toEqual({
      home: "/tmp/canary-data",
      source: "/tmp/canary-source",
      state: "/tmp/canary-data/canary-state.json",
      pid: "/tmp/canary-data/canary.pid",
      log: "/tmp/canary-data/canary.log",
    });
  });

  it("tracks main by default and accepts a stacked PR ref", () => {
    expect(parseCanaryArgs(["update"])).toEqual({ command: "update", ref: null });
    expect(parseCanaryArgs(["setup", "--ref", "codex/veylen-canary"])).toEqual({
      command: "setup",
      ref: "codex/veylen-canary",
    });
  });

  it("checks out the managed source during clone so the cleanliness guard starts clean", () => {
    expect(canaryCloneArgs("git@example.com:veylen.git", "/tmp/canary-source")).toEqual([
      "clone",
      "--",
      "git@example.com:veylen.git",
      "/tmp/canary-source",
    ]);
  });

  it("starts the desktop launcher directly so the persisted PID stays alive", () => {
    expect(canaryStartArgs()).toEqual(["apps/desktop/scripts/start-electron.mjs"]);
  });

  it("keeps updating the selected stacked ref until explicitly moved to main", () => {
    expect(resolveCanaryRef(parseCanaryArgs(["setup"]), null)).toBe("main");
    expect(resolveCanaryRef(parseCanaryArgs(["update"]), "codex/veylen-canary")).toBe(
      "codex/veylen-canary",
    );
    expect(resolveCanaryRef(parseCanaryArgs(["update", "--ref", "main"]), "old-ref")).toBe("main");
  });

  it("rejects unsupported commands and incomplete refs", () => {
    expect(() => parseCanaryArgs(["reset"])).toThrow(/Unknown Canary command/u);
    expect(() => parseCanaryArgs(["update", "--ref"])).toThrow(/Missing value/u);
  });
});
