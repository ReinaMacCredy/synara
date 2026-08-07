import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";

import { DEFAULT_SUPERVISION_PROFILES } from "./profileSeeds.ts";
import {
  codexProfileConfigArgs,
  profileLaunchIssue,
  resolveProfilePreset,
} from "./profileResolver.ts";

it.effect("seeds Lead and Specialist Codex presets with independent judgment law", () =>
  Effect.sync(() => {
    assert.deepEqual(
      DEFAULT_SUPERVISION_PROFILES.map((profile) => profile.name),
      ["Lead Default", "Specialist Implementer", "Specialist Reviewer"],
    );
    assert.ok(
      DEFAULT_SUPERVISION_PROFILES.filter((profile) => profile.roleHints.includes("peer")).every(
        (profile) =>
          profile.runtime.developerInstructions.includes(
            "Independent judgment is not performative dissent",
          ),
      ),
    );
    assert.ok(
      DEFAULT_SUPERVISION_PROFILES.every(
        (profile) =>
          profile.runtime.providerOptions !== undefined &&
          JSON.stringify(profile.runtime.providerOptions).includes('"multi_agent":false'),
      ),
    );
  }),
);

it.effect(
  "resolves an immutable content hash and blocks unsupported adapters without fallback",
  () =>
    Effect.sync(() => {
      const preset = DEFAULT_SUPERVISION_PROFILES[0]!;
      const first = resolveProfilePreset({
        preset,
        snapshotId: "snapshot-1" as never,
        createdAt: "2026-08-03T10:00:00.000Z",
      });
      const second = resolveProfilePreset({
        preset: { ...preset, name: "Renamed only" },
        snapshotId: "snapshot-2" as never,
        createdAt: "2026-08-03T10:01:00.000Z",
      });
      assert.equal(first.contentHash, second.contentHash);
      assert.equal(profileLaunchIssue(preset), null);
      assert.deepEqual(codexProfileConfigArgs(preset.runtime), [
        "--disable",
        "multi_agent",
        "--disable",
        "multi_agent_v2",
      ]);
      assert.match(
        profileLaunchIssue({
          ...preset,
          runtime: { ...preset.runtime, provider: "claudeAgent" },
        }) ?? "",
        /no fallback was applied/i,
      );
      assert.match(
        profileLaunchIssue({
          ...preset,
          runtime: { ...preset.runtime, providerOptions: { unsupported: true } },
        }) ?? "",
        /unsupported codex profile option group/i,
      );
    }),
);
