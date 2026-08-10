// FILE: veylenHome.ts
// Purpose: Resolves the user-level Veylen base directory without Effect, so the backend
// server and the Electron main process agree on one location during early startup.
// Exports: expandHomePath, resolveVeylenHomeDirectory, VEYLEN_HOME_ENV_NAME.

import * as OS from "node:os";
import * as Path from "node:path";
import * as FS from "node:fs";

export const VEYLEN_HOME_ENV_NAME = "VEYLEN_HOME";
export const DEFAULT_VEYLEN_HOME_DIRECTORY_NAME = ".veylen";
export const LEGACY_SYNARA_HOME_ENV_NAME = "SYNARA_HOME";
export const LEGACY_SYNARA_HOME_DIRECTORY_NAME = ".synara";

export function applyLegacyEnvironmentAliases(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("SYNARA_") || value === undefined) continue;
    const veylenKey = `VEYLEN_${key.slice("SYNARA_".length)}`;
    if (env[veylenKey] === undefined) env[veylenKey] = value;
  }
  return env;
}

/** Expands a leading `~` against the user's home directory; other inputs pass through. */
export function expandHomePath(input: string, homeDirectory: string = OS.homedir()): string {
  if (input === "~") {
    return homeDirectory;
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return Path.join(homeDirectory, input.slice(2));
  }
  return input;
}

/**
 * Resolves the Veylen base directory the same way for every process in the install.
 *
 * Deliberately plain Node: the Electron main process needs this before Effect (or even
 * `app.whenReady()`) is available, and the login-shell environment cache has to land in
 * the same place whichever process wrote it first.
 */
export function resolveVeylenHomeDirectory(
  options: {
    /** Explicit override; falls back to `VEYLEN_HOME` from `env`. */
    readonly configuredHome?: string | undefined;
    readonly env?: NodeJS.ProcessEnv;
    readonly homeDirectory?: string;
    /** Flavor-specific default (`.veylen-canary`), used only when nothing is configured. */
    readonly directoryName?: string;
  } = {},
): string {
  const homeDirectory = options.homeDirectory ?? OS.homedir();
  const env = options.env ?? process.env;
  const configured = (
    options.configuredHome ?? env[VEYLEN_HOME_ENV_NAME] ?? env[LEGACY_SYNARA_HOME_ENV_NAME]
  )?.trim();
  if (!configured) {
    const directoryName = options.directoryName ?? DEFAULT_VEYLEN_HOME_DIRECTORY_NAME;
    const veylenHome = Path.join(homeDirectory, directoryName);
    const legacyDirectoryName =
      directoryName === ".veylen-canary" ? ".synara-canary" : LEGACY_SYNARA_HOME_DIRECTORY_NAME;
    const legacyHome = Path.join(homeDirectory, legacyDirectoryName);
    if (!FS.existsSync(veylenHome) && FS.existsSync(legacyHome)) return legacyHome;
    return veylenHome;
  }
  return Path.resolve(expandHomePath(configured, homeDirectory));
}
