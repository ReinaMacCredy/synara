import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { KernelLanguage, RunPolicy } from "@veylen/contracts";

export type KernelIsolationMode = "required" | "auto" | "trusted-process";
export type KernelIsolationBackend = "macos-sandbox" | "trusted-process";

export interface KernelRuntimeOptions {
  readonly language: KernelLanguage;
  readonly workingDirectory: string;
  readonly policy: RunPolicy;
  readonly isolation: KernelIsolationMode;
  readonly environment?: Readonly<Record<string, string>>;
  readonly filesystemReadRoots?: ReadonlyArray<string>;
  readonly allowNetwork?: boolean;
  readonly allowFilesystemWrites?: boolean;
  readonly nodeBinary?: string;
  readonly pythonBinary?: string;
}

export interface KernelExecutionResult {
  readonly result: unknown;
  readonly stdout: string;
  readonly outputBytes: number;
}

interface HostResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly stdout?: string;
  readonly error?: string;
}

interface PendingExecution {
  readonly resolve: (value: KernelExecutionResult) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: NodeJS.Timeout;
}

const ALLOWED_ENV_KEYS = new Set(["LANG", "LC_ALL", "LC_CTYPE", "TZ", "PATH", "TMPDIR"]);
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));

async function executableExists(executable: string): Promise<boolean> {
  try {
    await access(executable);
    return true;
  } catch {
    return false;
  }
}

const escapeSandboxLiteral = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

function macosSandboxProfile(input: {
  readonly executable: string;
  readonly workingDirectory: string;
  readonly hostScript: string;
  readonly readRoots: ReadonlyArray<string>;
  readonly allowNetwork: boolean;
  readonly allowFilesystemWrites: boolean;
}): string {
  const readRules = [
    "/System",
    "/usr/lib",
    "/usr/share",
    "/private/var/db/timezone",
    path.dirname(input.executable),
    input.workingDirectory,
    input.hostScript,
    ...input.readRoots,
  ]
    .map((root) => `(subpath "${escapeSandboxLiteral(path.resolve(root))}")`)
    .join(" ");
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    `(allow process-exec (literal "${escapeSandboxLiteral(input.executable)}"))`,
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    `(allow file-read* ${readRules})`,
    input.allowFilesystemWrites
      ? `(allow file-write* (subpath "${escapeSandboxLiteral(input.workingDirectory)}"))`
      : "(deny file-write*)",
    input.allowNetwork ? "(allow network*)" : "(deny network*)",
  ].join(" ");
}

function sanitizedEnvironment(overrides: Readonly<Record<string, string>> = {}) {
  const environment: Record<string, string> = {};
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key];
    if (value) environment[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!ALLOWED_ENV_KEYS.has(key) && !key.startsWith("VEYLEN_KERNEL_")) {
      throw new Error(`Kernel environment key '${key}' is not allowlisted.`);
    }
    environment[key] = value;
  }
  return environment;
}

async function spawnKernelHost(
  options: KernelRuntimeOptions,
): Promise<{
  readonly child: ChildProcessWithoutNullStreams;
  readonly backend: KernelIsolationBackend;
}> {
  const workingDirectory = path.resolve(options.workingDirectory);
  await mkdir(workingDirectory, { recursive: true, mode: 0o700 });
  const hostScript =
    options.language === "javascript"
      ? path.join(runtimeDirectory, "kernelHost.mjs")
      : path.join(runtimeDirectory, "kernel_host.py");
  const executable =
    options.language === "javascript"
      ? (options.nodeBinary ?? process.execPath)
      : (options.pythonBinary ?? "/usr/bin/python3");
  if (!(await executableExists(executable))) {
    throw new Error(`${options.language} kernel executable '${executable}' was not found.`);
  }
  const languageArgs =
    options.language === "javascript"
      ? [`--max-old-space-size=${options.policy.maxKernelMemoryMiB}`, hostScript]
      : ["-I", hostScript];
  const sandboxAvailable =
    process.platform === "darwin" && (await executableExists("/usr/bin/sandbox-exec"));
  let command = executable;
  let args = languageArgs;
  let backend: KernelIsolationBackend = "trusted-process";
  if (options.isolation !== "trusted-process") {
    if (!sandboxAvailable) {
      if (options.isolation === "required") {
        throw new Error("A strong kernel isolation backend is required but unavailable.");
      }
    } else {
      backend = "macos-sandbox";
      command = "/usr/bin/sandbox-exec";
      args = [
        "-p",
        macosSandboxProfile({
          executable,
          workingDirectory,
          hostScript,
          readRoots: options.filesystemReadRoots ?? [],
          allowNetwork: options.allowNetwork ?? false,
          allowFilesystemWrites: options.allowFilesystemWrites ?? true,
        }),
        executable,
        ...languageArgs,
      ];
    }
  }
  const child = spawn(command, args, {
    cwd: workingDirectory,
    env: sanitizedEnvironment(options.environment),
    stdio: ["pipe", "pipe", "pipe"],
  });
  return { child, backend };
}

export class PersistentKernel {
  readonly backend: KernelIsolationBackend;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingExecution>();
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stopped = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    backend: KernelIsolationBackend,
    private readonly policy: RunPolicy,
  ) {
    this.child = child;
    this.backend = backend;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-16_384);
    });
    child.on("exit", (code, signal) => {
      this.stopped = true;
      const detail = this.stderrBuffer.trim();
      const error = new Error(
        `Kernel host exited (${signal ?? code ?? "unknown"})${detail ? `: ${detail}` : ""}.`,
      );
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  static async start(options: KernelRuntimeOptions): Promise<PersistentKernel> {
    const { child, backend } = await spawnKernelHost(options);
    return new PersistentKernel(child, backend, options.policy);
  }

  private consumeStdout(chunk: string) {
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer) > this.policy.maxKernelOutputBytes * 2) {
      this.stop();
      return;
    }
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      let response: HostResponse;
      try {
        response = JSON.parse(line) as HostResponse;
      } catch {
        this.stop();
        return;
      }
      const request = this.pending.get(response.id);
      if (!request) continue;
      this.pending.delete(response.id);
      clearTimeout(request.timeout);
      const outputBytes = Buffer.byteLength(JSON.stringify(response));
      if (outputBytes > this.policy.maxKernelOutputBytes) {
        request.reject(new Error("Kernel output exceeded RunPolicy."));
      } else if (!response.ok) {
        request.reject(new Error(response.error ?? "Kernel execution failed."));
      } else {
        request.resolve({
          result: response.result,
          stdout: response.stdout ?? "",
          outputBytes,
        });
      }
    }
  }

  execute(code: string, input: unknown = null): Promise<KernelExecutionResult> {
    if (this.stopped) return Promise.reject(new Error("Kernel host is stopped."));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          this.pending.delete(id);
          reject(new Error("Kernel execution exceeded RunPolicy wall time."));
          this.stop();
        },
        Math.min(this.policy.maxWallTimeMs, 2_147_483_647),
      );
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify({ id, code, input })}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.child.kill("SIGKILL");
  }
}
