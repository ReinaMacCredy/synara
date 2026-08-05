// FILE: activeWorkClock.test.ts
// Purpose: Pins remount-surviving Working-for continuity helpers.

import { describe, expect, it, beforeEach } from "vitest";
import { ThreadId } from "@synara/contracts";

import {
  clearActiveWorkStartedAt,
  readActiveWorkStartedAt,
  rememberActiveWorkStartedAt,
  resetActiveWorkClockForTests,
  resolveContinuousWorkStartedAt,
} from "./activeWorkClock";

const thread = ThreadId.makeUnsafe("root-1");

describe("activeWorkClock", () => {
  beforeEach(() => {
    resetActiveWorkClockForTests();
  });

  it("remembers the earliest stamp across remount-style rewrites", () => {
    rememberActiveWorkStartedAt(thread, "2026-08-05T18:56:00.000Z");
    rememberActiveWorkStartedAt(thread, "2026-08-05T18:56:02.000Z");
    expect(readActiveWorkStartedAt(thread)).toBe("2026-08-05T18:56:00.000Z");
  });

  it("survives clear of a different thread", () => {
    const other = ThreadId.makeUnsafe("root-2");
    rememberActiveWorkStartedAt(thread, "2026-08-05T18:56:00.000Z");
    clearActiveWorkStartedAt(other);
    expect(readActiveWorkStartedAt(thread)).toBe("2026-08-05T18:56:00.000Z");
  });

  it("resolveContinuousWorkStartedAt prefers the earlier of derived and persisted", () => {
    expect(
      resolveContinuousWorkStartedAt({
        derivedStartedAt: "2026-08-05T18:56:02.000Z",
        persistedStartedAt: "2026-08-05T18:56:00.000Z",
      }),
    ).toBe("2026-08-05T18:56:00.000Z");
    expect(
      resolveContinuousWorkStartedAt({
        derivedStartedAt: null,
        persistedStartedAt: "2026-08-05T18:56:00.000Z",
      }),
    ).toBe("2026-08-05T18:56:00.000Z");
    expect(
      resolveContinuousWorkStartedAt({
        derivedStartedAt: "2026-08-05T18:56:00.000Z",
        persistedStartedAt: null,
      }),
    ).toBe("2026-08-05T18:56:00.000Z");
  });
});
