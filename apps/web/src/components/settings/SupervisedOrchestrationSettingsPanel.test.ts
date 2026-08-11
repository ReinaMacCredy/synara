import { readFileSync } from "node:fs";

import { ProfilePresetId, type ProfilePreset } from "@veylen/contracts";
import { describe, expect, it } from "vitest";

import {
  EMPTY_DRAFT,
  profileDraftIsDirty,
  roleHintsFromDraft,
  validateProfileDraft,
} from "./SupervisedOrchestrationSettingsPanel";

const existingProfile = {
  id: ProfilePresetId.makeUnsafe("profile-existing"),
  name: "Lead Default",
  roleHints: ["lead"],
  runtime: {
    provider: "codex",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    developerInstructions: "",
    providerOptions: {},
  },
  isDefault: true,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  archivedAt: null,
  revision: 0,
} as ProfilePreset;

describe("supervised orchestration profile editor", () => {
  it("loads presets from the canonical durable Supervised settings snapshot", () => {
    const source = readFileSync(
      new URL("./SupervisedOrchestrationSettingsPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("api.orchestration.getSupervisedSettings()");
    expect(source).toContain("next.governance.orchestration");
    expect(source).not.toContain("next.supervisedOrchestration ?? shell");
  });

  it("reports required, duplicate-name, and JSON errors locally", () => {
    expect(
      validateProfileDraft({ ...EMPTY_DRAFT, name: "", model: "" }, [existingProfile]),
    ).toMatchObject({
      name: "Name is required.",
      model: "Model is required.",
    });

    expect(
      validateProfileDraft({ ...EMPTY_DRAFT, name: " lead default " }, [existingProfile]).name,
    ).toBe("A profile with this name already exists.");

    expect(
      validateProfileDraft({ ...EMPTY_DRAFT, providerOptions: '{ "enabled": true, }' }, []),
    ).toMatchObject({ providerOptions: "Provider options must be valid JSON." });

    for (const providerOptions of ["null", "[]", '"invalid"', "false"]) {
      expect(validateProfileDraft({ ...EMPTY_DRAFT, providerOptions }, [])).toMatchObject({
        providerOptions: "Provider options must be a JSON object.",
      });
    }
  });

  it("enables saving only for a new or changed draft", () => {
    const baseline = { ...EMPTY_DRAFT, id: existingProfile.id, name: existingProfile.name };

    expect(profileDraftIsDirty(baseline, baseline)).toBe(false);
    expect(profileDraftIsDirty({ ...baseline, model: "gpt-5.6-luna-new" }, baseline)).toBe(true);
    expect(profileDraftIsDirty({ ...EMPTY_DRAFT }, null)).toBe(true);
    expect(profileDraftIsDirty(null, null)).toBe(false);
  });

  it("preserves multi-role profiles and canonicalizes the legacy Specialist alias", () => {
    expect(roleHintsFromDraft("supervisor, lead, specialist, peer")).toEqual([
      "supervisor",
      "lead",
      "peer",
    ]);
  });
});
