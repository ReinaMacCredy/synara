import { describe, expect, it } from "vitest";

import {
  resolveVeylenDesktopFlavor,
  VEYLEN_CANARY_BUNDLE_ID,
  VEYLEN_CANARY_DESKTOP_ENTRY_URL,
  VEYLEN_CANARY_DESKTOP_ORIGIN,
  VEYLEN_DESKTOP_ENTRY_URL,
  VEYLEN_DESKTOP_ORIGIN,
  VEYLEN_DESKTOP_UPDATE_CHANNEL,
  VEYLEN_DEVELOPMENT_BUNDLE_ID,
  VEYLEN_PRODUCTION_BUNDLE_ID,
  veylenBundleId,
  veylenDesktopIdentity,
} from "./desktopIdentity";

describe("desktopIdentity", () => {
  it("uses the exact canonical production and development bundle IDs", () => {
    expect(VEYLEN_PRODUCTION_BUNDLE_ID).toBe("com.reinamaccredy.veylen");
    expect(VEYLEN_DEVELOPMENT_BUNDLE_ID).toBe("com.reinamaccredy.veylen.dev");
    expect(veylenBundleId(false)).toBe(VEYLEN_PRODUCTION_BUNDLE_ID);
    expect(veylenBundleId(true)).toBe(VEYLEN_DEVELOPMENT_BUNDLE_ID);
  });

  it("uses the exact packaged renderer origin and entry URL", () => {
    expect(VEYLEN_DESKTOP_ORIGIN).toBe("veylen://app");
    expect(VEYLEN_DESKTOP_ENTRY_URL).toBe("veylen://app/index.html");
  });

  it("uses the isolated Veylen desktop update channel", () => {
    expect(VEYLEN_DESKTOP_UPDATE_CHANNEL).toBe("veylen");
  });

  it("gives Canary a fully separate desktop identity and storage profile", () => {
    expect(VEYLEN_CANARY_BUNDLE_ID).toBe("com.reinamaccredy.veylen.canary");
    expect(VEYLEN_CANARY_DESKTOP_ORIGIN).toBe("veylen-canary://app");
    expect(VEYLEN_CANARY_DESKTOP_ENTRY_URL).toBe("veylen-canary://app/index.html");
    expect(veylenDesktopIdentity("canary")).toEqual({
      flavor: "canary",
      displayName: "Veylen Canary",
      bundleId: VEYLEN_CANARY_BUNDLE_ID,
      scheme: "veylen-canary",
      origin: VEYLEN_CANARY_DESKTOP_ORIGIN,
      entryUrl: VEYLEN_CANARY_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "veylen-canary",
      defaultHomeDirectoryName: ".veylen-canary",
      usesScriptedUpdates: true,
    });
  });

  it("selects Canary explicitly without changing normal dev and production defaults", () => {
    expect(resolveVeylenDesktopFlavor({ isDevelopment: false })).toBe("production");
    expect(resolveVeylenDesktopFlavor({ isDevelopment: true })).toBe("development");
    expect(resolveVeylenDesktopFlavor({ isDevelopment: false, requestedFlavor: " canary " })).toBe(
      "canary",
    );
    expect(resolveVeylenDesktopFlavor({ isDevelopment: true, requestedFlavor: "canary" })).toBe(
      "canary",
    );
  });
});
