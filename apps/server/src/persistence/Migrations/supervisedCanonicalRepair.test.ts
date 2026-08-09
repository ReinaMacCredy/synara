import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { DEFAULT_SUPERVISED_PROFILES } from "../../orchestration/supervised/profileSeeds.ts";
import { upcastLegacyDefaultProfiles } from "./supervisedCanonicalRepair.ts";

const legacyProfile = (profile: (typeof DEFAULT_SUPERVISED_PROFILES)[number]) => ({
  ...profile,
  name:
    profile.id === "profile-peer-implementer"
      ? "Specialist Implementer"
      : profile.id === "profile-peer-reviewer"
        ? "Specialist Reviewer"
        : profile.name,
  runtime: {
    ...profile.runtime,
    developerInstructions: profile.runtime.developerInstructions
      .replaceAll("Peers", "Specialists")
      .replaceAll("Peer", "Specialist"),
  },
});

describe("Supervised canonical migration repair", () => {
  it("upcasts untouched legacy defaults without overwriting customized built-in IDs", () => {
    const legacyReviewer = legacyProfile(DEFAULT_SUPERVISED_PROFILES[2]!);
    const customizedImplementer = {
      ...legacyProfile(DEFAULT_SUPERVISED_PROFILES[1]!),
      name: "My retained implementation profile",
    };

    const migrated = upcastLegacyDefaultProfiles([legacyReviewer, customizedImplementer]);

    assert.deepStrictEqual(migrated[0], DEFAULT_SUPERVISED_PROFILES[2]);
    assert.deepStrictEqual(migrated[1], customizedImplementer);
  });
});
