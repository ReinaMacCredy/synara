// FILE: check-supervised-compatibility.ts
// Purpose: Prevents production code from writing legacy Supervised vocabulary during its read window.
// Layer: CI preflight

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const forbiddenLegacyWriterPatterns = [
  /\btype\s*:\s*["']supervision\./u,
  /\btype\s*:\s*["']supervised\.specialist-/u,
  /\baggregateKind\s*:\s*["']specialist["']/u,
  /\brole\s*:\s*["']specialist["']/u,
] as const;

export interface LegacySupervisedWriterViolation {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export function isProductionTypeScriptPath(path: string): boolean {
  return (
    /^(apps|packages)\//u.test(path) &&
    /\.tsx?$/u.test(path) &&
    !/\.(test|spec|browser|e2e)\.tsx?$/u.test(path) &&
    !path.includes("/__tests__/")
  );
}

export function findLegacySupervisedWriterViolations(
  files: ReadonlyArray<{ readonly path: string; readonly contents: string }>,
): LegacySupervisedWriterViolation[] {
  const violations: LegacySupervisedWriterViolation[] = [];
  for (const file of files) {
    if (!isProductionTypeScriptPath(file.path)) continue;
    for (const [index, line] of file.contents.split(/\r?\n/u).entries()) {
      if (forbiddenLegacyWriterPatterns.some((pattern) => pattern.test(line))) {
        violations.push({ path: file.path, line: index + 1, text: line.trim() });
      }
    }
  }
  return violations;
}

function trackedProductionFiles(): string[] {
  return execFileSync("git", ["ls-files", "apps", "packages"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(isProductionTypeScriptPath);
}

if (import.meta.main) {
  const violations = findLegacySupervisedWriterViolations(
    trackedProductionFiles().map((path) => ({
      path,
      contents: readFileSync(resolve(repoRoot, path), "utf8"),
    })),
  );
  if (violations.length > 0) {
    console.error("Legacy Supervised writers are forbidden during the read-compatibility window:");
    for (const violation of violations) {
      console.error(`${violation.path}:${violation.line}: ${violation.text}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Supervised compatibility check passed: no production legacy writers found.");
  }
}
