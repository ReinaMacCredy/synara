// FILE: desktopIdentity.ts
// Purpose: Defines the canonical desktop application identity across packaging and runtime.

export const VEYLEN_DESKTOP_SCHEME = "veylen";
export const VEYLEN_DESKTOP_ORIGIN = `${VEYLEN_DESKTOP_SCHEME}://app`;
export const VEYLEN_DESKTOP_ENTRY_URL = `${VEYLEN_DESKTOP_ORIGIN}/index.html`;
export const VEYLEN_DESKTOP_UPDATE_CHANNEL = "veylen";
export const VEYLEN_PRODUCTION_BUNDLE_ID = "com.reinamaccredy.veylen";
export const VEYLEN_DEVELOPMENT_BUNDLE_ID = `${VEYLEN_PRODUCTION_BUNDLE_ID}.dev`;
export const VEYLEN_CANARY_BUNDLE_ID = `${VEYLEN_PRODUCTION_BUNDLE_ID}.canary`;
export const VEYLEN_CANARY_DESKTOP_SCHEME = "veylen-canary";
export const VEYLEN_CANARY_DESKTOP_ORIGIN = `${VEYLEN_CANARY_DESKTOP_SCHEME}://app`;
export const VEYLEN_CANARY_DESKTOP_ENTRY_URL = `${VEYLEN_CANARY_DESKTOP_ORIGIN}/index.html`;

export type VeylenDesktopFlavor = "production" | "development" | "canary";

export interface VeylenDesktopIdentity {
  readonly flavor: VeylenDesktopFlavor;
  readonly displayName: string;
  readonly bundleId: string;
  readonly scheme: string;
  readonly origin: string;
  readonly entryUrl: string;
  readonly userDataDirectoryName: string;
  readonly defaultHomeDirectoryName: string;
  readonly usesScriptedUpdates: boolean;
}

export function resolveVeylenDesktopFlavor(input: {
  readonly isDevelopment: boolean;
  readonly requestedFlavor?: string | undefined;
}): VeylenDesktopFlavor {
  if (input.requestedFlavor?.trim().toLowerCase() === "canary") {
    return "canary";
  }
  return input.isDevelopment ? "development" : "production";
}

export function veylenDesktopIdentity(flavor: VeylenDesktopFlavor): VeylenDesktopIdentity {
  if (flavor === "canary") {
    return {
      flavor,
      displayName: "Veylen Canary",
      bundleId: VEYLEN_CANARY_BUNDLE_ID,
      scheme: VEYLEN_CANARY_DESKTOP_SCHEME,
      origin: VEYLEN_CANARY_DESKTOP_ORIGIN,
      entryUrl: VEYLEN_CANARY_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "veylen-canary",
      defaultHomeDirectoryName: ".veylen-canary",
      usesScriptedUpdates: true,
    };
  }
  if (flavor === "development") {
    return {
      flavor,
      displayName: "Veylen (Dev)",
      bundleId: VEYLEN_DEVELOPMENT_BUNDLE_ID,
      scheme: VEYLEN_DESKTOP_SCHEME,
      origin: VEYLEN_DESKTOP_ORIGIN,
      entryUrl: VEYLEN_DESKTOP_ENTRY_URL,
      userDataDirectoryName: "veylen-dev",
      defaultHomeDirectoryName: ".veylen",
      usesScriptedUpdates: false,
    };
  }
  return {
    flavor,
    displayName: "Veylen",
    bundleId: VEYLEN_PRODUCTION_BUNDLE_ID,
    scheme: VEYLEN_DESKTOP_SCHEME,
    origin: VEYLEN_DESKTOP_ORIGIN,
    entryUrl: VEYLEN_DESKTOP_ENTRY_URL,
    userDataDirectoryName: "veylen",
    defaultHomeDirectoryName: ".veylen",
    usesScriptedUpdates: false,
  };
}

export function veylenBundleId(isDevelopment: boolean): string {
  return veylenDesktopIdentity(isDevelopment ? "development" : "production").bundleId;
}
