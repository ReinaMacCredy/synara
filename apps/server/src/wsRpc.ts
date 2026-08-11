import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  CommandId,
  DEFAULT_TERMINAL_ID,
  DEVICE_WS_METHODS,
  ORCHESTRATION_WS_METHODS,
  PluginInstallation,
  TaskProcessDomainEvent,
  TaskProcessId,
  SupervisedCommand,
  SupervisedGovernanceCommand,
  ThreadId,
  WS_BOOTSTRAP_METHOD,
  WS_BOOTSTRAP_PATH,
  WS_FEATURE_PATH,
  WS_NEGOTIATE_HTTP_PATH,
  WS_METHODS,
  WsBootstrapRpcGroup,
  WsCompatibilityError,
  WsDeviceRpcGroup,
  WsFeatureRpcGroup,
  WsRpcError,
  PullRequestsUnavailableError,
  type DeviceEvent,
  type GitActionProgressEvent,
  type GitHubProjectProvisionProgressEvent,
  type GitWorktreeSetupProgressEvent,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type ProjectDevServerEvent,
  type OrchestrationShellStreamEvent,
  type OrchestrationShellStreamItem,
  type OrchestrationThreadDetailSnapshot,
  type OrchestrationThreadStreamItem,
  type ProviderKind,
  type ServerConfigStreamEvent,
  type ServerDiagnosticsResult,
  type ServerLifecycleStreamEvent,
  type SupervisedToolPolicy,
} from "@veylen/contracts";
import { clamp } from "effect/Number";
import { Effect, FileSystem, Layer, Option, Path, Queue, Schema, Scope, Stream } from "effect";
import { Headers, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcMiddleware, RpcSchema, RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { AutomationService } from "./automation/Services/AutomationService";
import { authErrorResponse, makeEffectAuthRequest } from "./auth/effectHttp";
import {
  ServerAuth,
  type AuthError,
  type AuthRequest,
  type AuthenticatedSession,
  type ServerAuthShape,
} from "./auth/Services/ServerAuth";
import { SessionCredentialService } from "./auth/Services/SessionCredentialService";
import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig, type ServerConfigShape } from "./config";
import { realpathNearestExisting } from "./realpathNearestExisting";
import { workspaceRootsEqual } from "@veylen/shared/threadWorkspace";
import {
  isThreadDetailEventFor,
  THREAD_DETAIL_EVENT_TYPES,
} from "@veylen/shared/threadDetailEvents";
import { DevServerManager, findProjectDevServerForLocalServer } from "./devServerManager";
import { DeviceService } from "./device/Services/DeviceService";
import { makeWsDeviceHandlers } from "./device/wsDeviceHandlers";
import { makeDeviceFrameRouteLayer } from "./device/deviceFrameRoute";
import { GitCore } from "./git/Services/GitCore";
import { GitHubCli } from "./git/Services/GitHubCli";
import { GitManager } from "./git/Services/GitManager";
import { GitHubCliError } from "./git/Errors";
import { GitStatusBroadcaster } from "./git/Services/GitStatusBroadcaster";
import { TextGeneration } from "./git/Services/TextGeneration";
import {
  beginGitHandoff,
  completeGitHandoff,
  discardPendingGitHandoff,
  gitHandoffMetadataCommand,
  recordGitHandoffResult,
} from "./gitHandoffOperations";
import { Keybindings } from "./keybindings";
import { createLocalPreviewGrant } from "./localImageFiles";
import { listLocalServers, stopLocalServer } from "./localServerMonitor";
import { listManagedWorktrees, pruneProjectedArchivedManagedWorktrees } from "./managedWorktrees";
import {
  attachmentPrincipalForSession,
  CurrentManagedAttachmentPrincipal,
  LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
} from "./managedAttachmentPrincipal";
import { Open, resolveAvailableEditors } from "./open";
import { makeDispatchCommandNormalizer } from "./orchestration/dispatchCommandNormalization";
import { makeImportThreadHandler } from "./orchestration/importThreadRoute";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { HostToolRuntime } from "./orchestration/Services/HostToolRuntime";
import { SupervisedRuntimeDaemon } from "./orchestration/Services/SupervisedRuntimeDaemon";
import { ProviderCommandReactor } from "./orchestration/Services/ProviderCommandReactor";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { TaskProcessQuery } from "./orchestration/Services/TaskProcessQuery";
import { shouldPublishThreadShellForEvent } from "./orchestration/threadShellEvents";
import { ProviderDiscoveryService } from "./provider/Services/ProviderDiscoveryService";
import { discoverSkillsCatalog, veylenSkillsDir } from "./provider/skillsCatalog";
import { recoverUnregisteredGitHubCheckout } from "./project/githubProjectRegistration";
import { ProviderAdapterRegistry } from "./provider/Services/ProviderAdapterRegistry";
import { ProviderHealth } from "./provider/Services/ProviderHealth";
import { ProviderService } from "./provider/Services/ProviderService";
import { listProviderUsage } from "./providerUsage";
import { getProviderUsageSnapshot } from "./providerUsageSnapshot";
import { ProfileStatsQuery } from "./profileStats";
import { redactSensitiveProcessArgs } from "./processArgumentRedaction";
import { ServerEnvironment } from "./environment/Services/ServerEnvironment";
import { ExternalMcpService } from "./externalMcp/Services/ExternalMcpService";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { isLoopbackHost } from "./startupAccess";
import { TerminalManager } from "./terminal/Services/Manager";
import { TerminalThreadTitleTracker } from "./terminal/terminalThreadTitleTracker";
import { resolveOutOfRootFileReference } from "./workspace/outOfRootFileReference";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import {
  WorkspaceFileConflictError,
  WorkspaceFileDeletedError,
  WorkspaceFileSystem,
} from "./workspace/Services/WorkspaceFileSystem";
import {
  MAX_STREAMS_PER_RPC_CLIENT,
  MAX_THREAD_STREAMS_PER_RPC_CLIENT,
  makeWsStreamAdmission,
} from "./wsStreamAdmission";
import { ThreadDiagnosticsQuery } from "./diagnostics/Services/ThreadDiagnosticsQuery";
import { makeWsRequestAdmission } from "./wsRequestAdmission";
import { voiceUploadAdmissionGate } from "./voiceUploadAdmission";
import {
  CurrentWsSessionRole,
  provideWsConnectionSession,
  WS_CONNECTION_SESSION_HEADER,
  WsConnectionSessions,
  WsConnectionSessionsLive,
  type WsConnectionSession,
} from "./wsConnectionSessions";
import {
  negotiateWsCompatibility,
  parseWsNegotiateSearchParams,
  validateWsFeatureCompatibility,
} from "./wsCompatibility";
import {
  isTrustedAppOrigin,
  normalizeCorsOrigin,
  requiresWebSocketAuthentication,
  shouldRejectUntrustedRequestOrigin,
} from "./trustedOrigins";
import { bufferLiveUiStream, type LiveUiStreamDropReport } from "./wsStreamBackpressure";
import { makeCursorSafeSnapshotLiveStream } from "./wsSnapshotLiveStream";
import { PullRequestService } from "./pullRequests/Services/PullRequestService";
import { resolveGitHubRepository } from "./pullRequests/repositoryResolution";
import { OrchestrationEventStore } from "./persistence/Services/OrchestrationEventStore";
import { SupervisedRuntimeRepository } from "./persistence/Services/SupervisedRuntimeRepository";
import { SupervisedGovernanceRepository } from "./persistence/Services/SupervisedGovernanceRepository";
import { SupervisedToolPolicyRepository } from "./persistence/Services/SupervisedToolPolicies";
import { SupervisedToolReceiptRepository } from "./persistence/Services/SupervisedToolReceipts";
import { ModelRoutingService } from "./supervised/modelRouting/ModelRoutingService";
import { prepareOwnerCuratedModelCapabilityProfile } from "./supervised/modelRouting/ModelCapabilityProvisioning";
import { projectSupervisedSystemTools } from "./supervised/settings/SupervisedSettingsProjection";
import { supervisedIntentToolRegistry } from "./supervised/tools/Registry";
import { evaluateSyntheticSubscriptionTest } from "./supervised/signal/SubscriptionEvaluator";
import { inspectSupervisedPluginPackage } from "./supervised/runtime/PluginPackage";
import { ProjectionTaskProcessRepository } from "./persistence/Services/ProjectionTaskProcess";
import { HandoffPreparationService } from "./handoff/Services/HandoffPreparationService";
import {
  profileLaunchIssue,
  resolveProfilePreset,
} from "./orchestration/supervised/profileResolver";
import {
  GitHubProjectProvisioningError,
  makeGitHubProjectProvisioner,
} from "./project/githubProjectProvisioning";

export function canManageExternalMcp(role: "owner" | "client"): boolean {
  return role === "owner";
}

export const findAcceptedAggregateEvent = <Event extends { readonly commandId: CommandId | null }>(
  events: readonly Event[],
  commandId: CommandId,
): Event | undefined => events.find((event) => event.commandId === commandId);

const MAX_DIAGNOSTIC_CHILD_PROCESSES = 80;
const MAX_DIAGNOSTIC_ARGS_CHARS = 500;

// Bounded window a thread subscription waits for the projector to commit the
// thread's detail read model before failing with THREAD_SNAPSHOT_NOT_FOUND.
// Covers subscribe-vs-projection races on freshly created threads; a thread
// that truly does not exist still fails, just this much later.
const THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_TIMEOUT_MS = 5_000;
const THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_POLL_MS = 100;

class WsRequestAdmissionMiddleware extends RpcMiddleware.Service<WsRequestAdmissionMiddleware>()(
  "veylen/WsRequestAdmissionMiddleware",
  { error: WsRpcError, requiredForClient: false },
) {}

// The device group is defined separately in contracts because its engine is
// macOS-only, but it is served on the same socket: one connection, one
// admission middleware, one exhaustive handler map.
const AdmittedWsFeatureRpcGroup = WsFeatureRpcGroup.merge(WsDeviceRpcGroup).middleware(
  WsRequestAdmissionMiddleware,
);

const wsRequestAdmissionMiddlewareLayer = Layer.effect(
  WsRequestAdmissionMiddleware,
  Effect.gen(function* () {
    const admission = yield* makeWsRequestAdmission;
    const connectionSessions = yield* WsConnectionSessions;
    return ((effect, options) => {
      // Handler fibers descend from the RPC server fiber (forked at layer build),
      // not from the connection's HTTP upgrade fiber, so connection-scoped
      // services must be re-provided here from the connection-session registry.
      const scoped = provideWsConnectionSession(
        effect,
        connectionSessions.lookup(Headers.get(options.headers, WS_CONNECTION_SESSION_HEADER)),
      );
      return RpcSchema.isStreamSchema(options.rpc.successSchema)
        ? scoped
        : admission.guard(options.clientId, options.rpc._tag, scoped);
    }) satisfies RpcMiddleware.RpcMiddleware<never, WsRpcError, never>;
  }),
);

// Relative subdirectories scaffolded under a freshly created chat container workspace root.
const CHAT_WORKSPACE_SUBDIRECTORIES = ["work", "outputs"] as const;

const sameStringSet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) => {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
};

const sameScopeSet = (left: ReadonlyArray<object>, right: ReadonlyArray<object>) =>
  sameStringSet(
    left.map((scope) => JSON.stringify(scope)),
    right.map((scope) => JSON.stringify(scope)),
  );

export function pluginInstallStepIdempotencyKey(input: {
  readonly step:
    | "plugin-subscription"
    | "plugin-subscription-revoke"
    | "plugin-reset-circuit"
    | "plugin-enable"
    | "plugin-subscription-enable";
  readonly pluginId: string;
  readonly packageIdentity: string;
  readonly expectedRevision: number;
  readonly subscriptionId?: string;
}) {
  return [
    input.step,
    input.pluginId,
    input.packageIdentity,
    ...(input.subscriptionId === undefined ? [] : [input.subscriptionId]),
    input.expectedRevision,
  ].join(":");
}

interface ProcessTableRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssBytes: number;
  readonly virtualSizeBytes: number;
  readonly command: string;
  readonly args: string;
}

function redactAndTruncateProcessArgs(args: string): string {
  const redacted = redactSensitiveProcessArgs(args);
  return redacted.length > MAX_DIAGNOSTIC_ARGS_CHARS
    ? `${redacted.slice(0, Math.max(0, MAX_DIAGNOSTIC_ARGS_CHARS - 15))}... [truncated]`
    : redacted;
}

function parseProcessTable(output: string): ProcessTableRow[] {
  const rows: ProcessTableRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) {
      continue;
    }
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      virtualSizeBytes: Number(match[4]) * 1024,
      command: match[5] ?? "",
      args: redactAndTruncateProcessArgs(match[6] ?? ""),
    });
  }
  return rows;
}

function collectDescendantProcesses(
  rows: readonly ProcessTableRow[],
  rootPid: number,
): ProcessTableRow[] {
  const childrenByParent = new Map<number, ProcessTableRow[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row);
    childrenByParent.set(row.ppid, children);
  }

  const descendants: ProcessTableRow[] = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const row = stack.pop()!;
    descendants.push(row);
    stack.push(...(childrenByParent.get(row.pid) ?? []));
  }
  return descendants.toSorted((left, right) => right.rssBytes - left.rssBytes);
}

function readDescendantProcesses(rootPid: number): Promise<ProcessTableRow[]> {
  if (process.platform === "win32") {
    return Promise.resolve([]);
  }
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid=,rss=,vsz=,comm=,args="],
      { maxBuffer: 2 * 1024 * 1024 },
      (_error, stdout) => {
        resolve(collectDescendantProcesses(parseProcessTable(stdout), rootPid));
      },
    );
  });
}

function toWsRpcError(cause: unknown, fallbackMessage: string) {
  return Schema.is(WsRpcError)(cause)
    ? cause
    : new WsRpcError({
        message:
          cause instanceof Error && cause.message.length > 0 ? cause.message : fallbackMessage,
        cause,
      });
}

type OpaquePageCursor = Readonly<Record<string, string | number>>;

function encodeOpaquePageCursor(cursor: OpaquePageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeOpaquePageCursor(
  cursor: string | undefined,
  requiredFields: ReadonlyArray<string>,
): OpaquePageCursor | null {
  if (cursor === undefined) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      value !== null &&
      typeof value === "object" &&
      requiredFields.every((field) => {
        const item = (value as Record<string, unknown>)[field];
        return typeof item === "string" || typeof item === "number";
      })
    ) {
      return value as OpaquePageCursor;
    }
  } catch {
    // Converted to a stable public RPC error below.
  }
  throw new WsRpcError({ message: "Invalid pagination cursor." });
}

function boundedRpcLimit(value: number | undefined, fallback = 50): number {
  return Math.max(1, Math.min(100, Math.floor(value ?? fallback)));
}

const failLiveUiStreamForSnapshotResync = (report: LiveUiStreamDropReport) =>
  Effect.fail(
    new WsRpcError({
      message: `${report.message}; restarting stream to refresh snapshot.`,
    }),
  );

// Must mirror the cases of toShellStreamEvent: events rejected here are dropped
// before the live-UI buffer so the sliding window only holds events that can
// actually project to a shell update.
function isShellRelevantEvent(event: OrchestrationEvent): boolean {
  return (
    event.type === "space.created" ||
    event.type === "space.meta-updated" ||
    event.type === "space.order-updated" ||
    event.type === "space.deleted" ||
    event.type === "project.created" ||
    event.type === "project.meta-updated" ||
    event.type === "project.deleted" ||
    event.type === "thread.deleted" ||
    event.aggregateKind === "supervision" ||
    event.aggregateKind === "supervised_governance" ||
    (event.aggregateKind === "thread" && shouldPublishThreadShellForEvent(event))
  );
}

const makeWsRpcHandlersLayer = () =>
  AdmittedWsFeatureRpcGroup.toLayer(
    Effect.gen(function* () {
      const checkpointDiffQuery = yield* CheckpointDiffQuery;
      const automationService = yield* AutomationService;
      const config = yield* ServerConfig;
      const devServerManager = yield* DevServerManager;
      const fileSystem = yield* FileSystem.FileSystem;
      const externalMcp = yield* ExternalMcpService;
      const git = yield* GitCore;
      const github = yield* GitHubCli;
      const gitManager = yield* GitManager;
      const gitStatusBroadcaster = yield* GitStatusBroadcaster;
      const keybindings = yield* Keybindings;
      const open = yield* Open;
      const orchestrationEngine = yield* OrchestrationEngineService;
      const hostToolRuntime = yield* HostToolRuntime;
      const orchestrationEventStore = yield* OrchestrationEventStore;
      const supervisedGovernanceRepository = yield* SupervisedGovernanceRepository;
      const supervisedRuntimeRepository = yield* SupervisedRuntimeRepository;
      const supervisedToolPolicyRepository = yield* SupervisedToolPolicyRepository;
      const supervisedToolReceiptRepository = yield* SupervisedToolReceiptRepository;
      const supervisedRuntimeDaemon = yield* SupervisedRuntimeDaemon;
      const modelRoutingService = yield* ModelRoutingService;
      const handoffPreparation = yield* HandoffPreparationService;
      const taskProcessProjections = yield* ProjectionTaskProcessRepository;
      const taskProcessQuery = yield* TaskProcessQuery;
      const providerCommandReactor = yield* ProviderCommandReactor;
      const path = yield* Path.Path;
      const pullRequests = yield* PullRequestService;
      const profileStatsQuery = yield* ProfileStatsQuery;
      const projectionReadModelQuery = yield* ProjectionSnapshotQuery;
      const providerAdapterRegistry = yield* ProviderAdapterRegistry;
      const providerDiscoveryService = yield* ProviderDiscoveryService;
      const providerHealth = yield* ProviderHealth;
      const providerService = yield* ProviderService;
      const lifecycleEvents = yield* ServerLifecycleEvents;
      const runtimeStartup = yield* ServerRuntimeStartup;
      const serverEnvironment = yield* ServerEnvironment;
      const serverSettings = yield* ServerSettingsService;
      const terminalManager = yield* TerminalManager;
      const textGeneration = yield* TextGeneration;
      const workspaceEntries = yield* WorkspaceEntries;
      const workspaceFileSystem = yield* WorkspaceFileSystem;
      const threadDiagnostics = yield* ThreadDiagnosticsQuery;
      // Optional so route-level tests and non-macOS builds can mount the RPC
      // group without a device engine; the handlers below then refuse cleanly
      // with the same unsupported-platform answer the backend would give.
      const deviceService = Option.getOrUndefined(yield* Effect.serviceOption(DeviceService));
      const githubProjectProvisioner = yield* makeGitHubProjectProvisioner({
        homeDir: config.homeDir,
        fileSystem,
        path,
        git,
        github,
      });
      const streamAdmission = yield* makeWsStreamAdmission({
        recordRejection: (incident) =>
          threadDiagnostics
            .recordOperationalDiagnostic({
              ...(incident.threadId ? { threadId: incident.threadId } : {}),
              source: "server",
              kind: "ws.stream-admission-rejected",
              severity: "warning",
              code: incident.errorCode,
              detail: {
                reason: incident.reason,
                active: incident.active,
                activeThreads: incident.activeThreads,
                streamLimit: MAX_STREAMS_PER_RPC_CLIENT,
                threadLimit: MAX_THREAD_STREAMS_PER_RPC_CLIENT,
              },
              occurredAt: new Date().toISOString(),
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning("Failed to persist streaming RPC rejection diagnostic.", {
                  error: String(error),
                }),
              ),
            ),
      });
      const recordThreadStreamDrop = (threadId: string, report: LiveUiStreamDropReport) =>
        threadDiagnostics
          .recordOperationalDiagnostic({
            threadId,
            source: "server",
            kind: "ws.thread-stream-events-dropped",
            severity: "error",
            code: "THREAD_STREAM_EVENTS_DROPPED",
            detail: {
              label: report.label,
              capacity: report.capacity,
              droppedAtLeast: report.droppedAtLeast,
            },
            occurredAt: new Date().toISOString(),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to persist thread stream drop diagnostic.", {
                error: String(error),
              }),
            ),
            (diagnostic) => Effect.sync(() => Effect.runFork(diagnostic)),
            Effect.andThen(failLiveUiStreamForSnapshotResync(report)),
          );
      const recordThreadResnapshotRequired = (
        threadId: string,
        report: {
          readonly snapshotSequence: number;
          readonly highWaterSequence: number;
          readonly replayCount: number;
          readonly replayLimit: number;
        },
      ) =>
        threadDiagnostics
          .recordOperationalDiagnostic({
            threadId,
            source: "server",
            kind: "ws.thread-stream-resnapshot-required",
            severity: "warning",
            code: "ORCHESTRATION_RESNAPSHOT_REQUIRED",
            detail: {
              snapshotSequence: report.snapshotSequence,
              highWaterSequence: report.highWaterSequence,
              replayCount: report.replayCount,
              replayLimit: report.replayLimit,
            },
            occurredAt: new Date().toISOString(),
          })
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning("Failed to persist thread resnapshot diagnostic.", {
                error: String(error),
              }),
            ),
          );

      // A thread subscription can race the projector: the client subscribes the
      // moment a create/turn RPC resolves, while the detail read model commits
      // asynchronously behind the journal. Failing straight away with
      // THREAD_SNAPSHOT_NOT_FOUND tears the stream down for a thread the server
      // is actively running. Waiting here is safe because the cursor-safe
      // stream attaches its live tap before evaluating the snapshot effect, so
      // no event that commits during the wait is lost.
      const loadThreadDetailSnapshotWithBootstrapWait = (threadId: ThreadId) =>
        Effect.gen(function* () {
          const deadline = Date.now() + THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_TIMEOUT_MS;
          while (true) {
            const detail = yield* projectionReadModelQuery.getThreadDetailSnapshotById(threadId);
            if (Option.isSome(detail) || Date.now() >= deadline) {
              return detail;
            }
            yield* Effect.sleep(THREAD_DETAIL_SNAPSHOT_BOOTSTRAP_POLL_MS);
          }
        });

      const isGlobalGitHubCliError = (error: unknown): error is GitHubCliError =>
        error instanceof GitHubCliError &&
        (error.reason === "not-installed" || error.reason === "not-authenticated");

      const toPullRequestsRpcError = (cause: unknown, fallbackMessage: string) => {
        if (isGlobalGitHubCliError(cause)) {
          return new PullRequestsUnavailableError({
            reason: cause.reason === "not-installed" ? "gh-not-installed" : "gh-not-authenticated",
            message: cause.detail,
          });
        }
        return toWsRpcError(cause, fallbackMessage);
      };

      const pullRequestsEffect = <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        fallbackMessage: string,
      ) => effect.pipe(Effect.mapError((cause) => toPullRequestsRpcError(cause, fallbackMessage)));
      const canonicalizeProjectWorkspaceRoot = Effect.fnUntraced(function* (
        workspaceRoot: string,
        options: { readonly createIfMissing?: boolean } = {},
      ) {
        const rawWorkspaceRoot = workspaceRoot.trim();
        const expandedWorkspaceRoot =
          rawWorkspaceRoot === "~"
            ? config.homeDir
            : rawWorkspaceRoot.startsWith("~/") || rawWorkspaceRoot.startsWith("~\\")
              ? path.join(config.homeDir, rawWorkspaceRoot.slice(2))
              : rawWorkspaceRoot;
        const normalizedWorkspaceRoot = path.resolve(expandedWorkspaceRoot);
        let workspaceStat = yield* fileSystem
          .stat(normalizedWorkspaceRoot)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!workspaceStat) {
          if (!options.createIfMissing) {
            return yield* new WsRpcError({
              message: `Project directory does not exist: ${normalizedWorkspaceRoot}`,
            });
          }
          yield* fileSystem.makeDirectory(normalizedWorkspaceRoot, { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new WsRpcError({
                  message: `Failed to create project directory: ${normalizedWorkspaceRoot}`,
                  cause,
                }),
            ),
          );
          workspaceStat = yield* fileSystem
            .stat(normalizedWorkspaceRoot)
            .pipe(Effect.catch(() => Effect.succeed(null)));
          if (!workspaceStat) {
            return yield* new WsRpcError({
              message: `Failed to create project directory: ${normalizedWorkspaceRoot}`,
            });
          }
        }
        if (workspaceStat.type !== "Directory") {
          return yield* new WsRpcError({
            message: `Project path is not a directory: ${normalizedWorkspaceRoot}`,
          });
        }
        return yield* realpathNearestExisting(normalizedWorkspaceRoot).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        );
      });
      const prepareWorkspaceSubdirectories = Effect.fnUntraced(function* (
        workspaceRoot: string,
        relativeDirnames: readonly string[],
      ) {
        for (const dirname of relativeDirnames) {
          const childPath = path.join(workspaceRoot, dirname);
          yield* fileSystem.makeDirectory(childPath, { recursive: true }).pipe(
            Effect.mapError(
              (cause) =>
                new WsRpcError({
                  message: `Failed to create workspace directory: ${childPath}`,
                  cause,
                }),
            ),
          );
        }
      });
      const prepareChatWorkspaceRoot = (workspaceRoot: string) =>
        prepareWorkspaceSubdirectories(workspaceRoot, CHAT_WORKSPACE_SUBDIRECTORIES);

      const normalizeDispatchCommand = makeDispatchCommandNormalizer<WsRpcError>({
        attachmentsDir: config.attachmentsDir,
        chatWorkspaceRoot: config.chatWorkspaceRoot,
        fileSystem,
        path,
        canonicalizeProjectWorkspaceRoot,
        prepareChatWorkspaceRoot,
      });

      const importThread = makeImportThreadHandler({
        fileSystem,
        orchestrationEngine,
        path,
        platform: process.platform,
        projectionSnapshotQuery: projectionReadModelQuery,
        providerAdapterRegistry,
        providerService,
      });

      const dispatchOrchestrationCommand = (command: OrchestrationCommand) =>
        Effect.gen(function* () {
          const attachmentPrincipal = yield* CurrentManagedAttachmentPrincipal;
          return yield* runtimeStartup.enqueueCommand(
            orchestrationEngine.dispatch(command, { attachmentPrincipal }),
          );
        });

      // Terminal-first threads are created with the generic "New terminal" placeholder.
      // The tracker buffers per-terminal input and, once a meaningful command is submitted,
      // surfaces a safe title used to auto-rename the thread on its first command.
      const terminalTitleTracker = new TerminalThreadTitleTracker();
      const resetTerminalTitleBuffer = (threadId: string, terminalId: string | null) =>
        Effect.sync(() => terminalTitleTracker.reset(threadId, terminalId));
      // Terminal auto-titles are best-effort metadata and must never block or fail terminal writes.
      const maybeAutoRenameTerminalThread = Effect.fnUntraced(function* (input: {
        threadId: string;
        terminalId: string;
        data: string;
      }) {
        const readModel = yield* orchestrationEngine.getReadModel();
        const thread = readModel.threads.find((entry) => entry.id === input.threadId);
        if (!thread) {
          return;
        }
        const nextTitle = terminalTitleTracker.consumeWrite({
          currentTitle: thread.title,
          data: input.data,
          terminalId: input.terminalId,
          threadId: input.threadId,
        });
        if (!nextTitle) {
          return;
        }
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.makeUnsafe(`server:terminal-title-rename:${crypto.randomUUID()}`),
          threadId: ThreadId.makeUnsafe(input.threadId),
          title: nextTitle,
        });
      });

      const stopLocalServerAndTrackedProjectRun = Effect.fnUntraced(function* (input: {
        pid: number;
        port: number;
      }) {
        const localServer =
          (yield* Effect.promise(() => listLocalServers())).servers.find(
            (server) => server.pid === input.pid && server.ports.includes(input.port),
          ) ?? null;
        const result = yield* Effect.promise(() => stopLocalServer(input, localServer));
        if (localServer?.isStoppable) {
          const devServers = yield* devServerManager.list;
          const trackedServer = findProjectDevServerForLocalServer({
            localServer,
            devServers: devServers.servers,
          });
          if (trackedServer) {
            yield* devServerManager
              .stop({ projectId: trackedServer.projectId })
              .pipe(Effect.catch(() => Effect.void));
          }
        }
        return result;
      });

      const loadServerConfig = Effect.gen(function* () {
        const keybindingsConfig = yield* keybindings.loadConfigState;
        const providerStatuses = yield* providerHealth.getStatuses;
        return {
          cwd: config.cwd,
          homeDir: config.homeDir,
          chatWorkspaceRoot: config.chatWorkspaceRoot,
          worktreesDir: config.worktreesDir,
          keybindingsConfigPath: config.keybindingsConfigPath,
          keybindings: keybindingsConfig.keybindings,
          issues: keybindingsConfig.issues,
          providers: providerStatuses,
          availableEditors: resolveAvailableEditors(),
        };
      });

      const refreshGitStatusAfter = <A, E, R>(cwd: string, effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.tap(() =>
            gitStatusBroadcaster.refreshStatus(cwd).pipe(Effect.catchCause(() => Effect.void)),
          ),
        );

      const refreshGitStatusInBackground = (cwd: string) =>
        gitStatusBroadcaster.refreshStatus(cwd).pipe(
          Effect.catchCause(() => Effect.void),
          Effect.forkDetach,
          Effect.asVoid,
        );

      const pruneManagedWorktrees = pruneProjectedArchivedManagedWorktrees({
        homeDir: config.homeDir,
        worktreesDir: config.worktreesDir,
        snapshotQuery: projectionReadModelQuery,
        git,
      }).pipe(
        // A retention failure must not present as an empty inventory: fall back
        // to a plain scan so listing callers still see the real worktrees.
        Effect.catchCause((cause) =>
          Effect.logWarning("managed worktree retention failed", {
            cause: String(cause),
          }).pipe(
            Effect.andThen(
              listManagedWorktrees({ worktreesDir: config.worktreesDir, git }).pipe(
                Effect.catchCause((listCause) =>
                  Effect.logWarning("managed worktree inventory scan failed", {
                    cause: String(listCause),
                  }).pipe(Effect.as([])),
                ),
              ),
            ),
          ),
        ),
      );
      const getOrchestrationHighWaterSequence = orchestrationEngine.getEventHighWaterSequence.pipe(
        Effect.mapError((cause) =>
          toWsRpcError(cause, "Failed to capture orchestration high-water sequence"),
        ),
      );

      const toShellStreamEvent = (
        event: OrchestrationEvent,
      ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never> => {
        switch (event.type) {
          case "space.created":
          case "space.meta-updated":
            return projectionReadModelQuery.getSpaceShellById(event.payload.spaceId).pipe(
              Effect.map((space) =>
                Option.map(space, (nextSpace) => ({
                  kind: "space-upserted" as const,
                  sequence: event.sequence,
                  space: nextSpace,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "space.order-updated":
            return Effect.succeed(
              Option.some({
                kind: "space-order-updated" as const,
                sequence: event.sequence,
                orderedSpaceIds: event.payload.orderedSpaceIds,
              }),
            );
          case "space.deleted":
            return Effect.succeed(
              Option.some({
                kind: "space-removed" as const,
                sequence: event.sequence,
                spaceId: event.payload.spaceId,
                updatedAt: event.payload.deletedAt,
              }),
            );
          case "project.created":
          case "project.meta-updated":
            return projectionReadModelQuery.getProjectShellById(event.payload.projectId).pipe(
              Effect.map((project) =>
                Option.map(project, (nextProject) => ({
                  kind: "project-upserted" as const,
                  sequence: event.sequence,
                  project: nextProject,
                })),
              ),
              Effect.catch(() => Effect.succeed(Option.none())),
            );
          case "project.deleted":
            return Effect.succeed(
              Option.some({
                kind: "project-removed" as const,
                sequence: event.sequence,
                projectId: event.payload.projectId,
              }),
            );
          case "thread.deleted":
            return Effect.succeed(
              Option.some({
                kind: "thread-removed" as const,
                sequence: event.sequence,
                threadId: event.payload.threadId,
              }),
            );
          default:
            if (
              event.aggregateKind === "supervision" ||
              event.aggregateKind === "supervised_governance"
            ) {
              return projectionReadModelQuery.getSupervisedOrchestrationShellSnapshot().pipe(
                Effect.map((supervisedOrchestration) =>
                  Option.some({
                    kind: "supervised-orchestration-updated" as const,
                    sequence: event.sequence,
                    supervisedOrchestration,
                  }),
                ),
                Effect.catch(() => Effect.succeed(Option.none())),
              );
            }
            if (event.aggregateKind !== "thread") return Effect.succeed(Option.none());
            return projectionReadModelQuery
              .getThreadShellById(ThreadId.makeUnsafe(String(event.aggregateId)))
              .pipe(
                Effect.map((thread) =>
                  Option.map(thread, (nextThread) => ({
                    kind: "thread-upserted" as const,
                    sequence: event.sequence,
                    thread: nextThread,
                  })),
                ),
                Effect.catch(() => Effect.succeed(Option.none())),
              );
        }
      };

      const rpcEffect = <A, E, R>(effect: Effect.Effect<A, E, R>, fallbackMessage: string) =>
        effect.pipe(Effect.mapError((cause) => toWsRpcError(cause, fallbackMessage)));

      const toProjectProvisionRpcError = (cause: unknown) =>
        cause instanceof GitHubProjectProvisioningError
          ? new WsRpcError({
              message: cause.message,
              code: cause.code,
              retryable: cause.retryable,
            })
          : toWsRpcError(cause, "Failed to clone and add the GitHub project");

      const findRegisteredProjectId = (workspaceRoot: string) =>
        orchestrationEngine
          .getReadModel()
          .pipe(
            Effect.map(
              (readModel) =>
                readModel.projects.find(
                  (project) =>
                    project.kind === "project" &&
                    project.deletedAt === null &&
                    workspaceRootsEqual(project.workspaceRoot, workspaceRoot),
                )?.id ?? null,
            ),
          );

      const requireOwner = Effect.gen(function* () {
        if (!canManageExternalMcp(yield* CurrentWsSessionRole)) {
          return yield* Effect.fail(
            new WsRpcError({ message: "Owner authorization is required for this operation." }),
          );
        }
        if (!isLoopbackHost(config.host) || config.publicUrl !== undefined) {
          return yield* Effect.fail(
            new WsRpcError({
              message: "External MCP management is available only on a loopback-only instance.",
            }),
          );
        }
      });

      const requireOwnerSession = Effect.gen(function* () {
        if ((yield* CurrentWsSessionRole) !== "owner") {
          return yield* Effect.fail(
            new WsRpcError({ message: "Owner authorization is required for this operation." }),
          );
        }
      });

      const readAcceptedAggregateEvent = (input: {
        readonly aggregateKind: "task_process";
        readonly aggregateId: TaskProcessId;
        readonly commandId: CommandId;
        readonly sequence: number;
      }) =>
        orchestrationEventStore
          .readAggregateEventPage({
            aggregateKind: input.aggregateKind,
            aggregateId: input.aggregateId,
            beforeSequenceExclusive: input.sequence + 1,
            limit: 8,
          })
          .pipe(
            Effect.flatMap((events) => {
              const event = findAcceptedAggregateEvent(events, input.commandId);
              return event !== undefined
                ? Effect.succeed(event)
                : Effect.fail(
                    new Error(
                      `Accepted ${input.aggregateKind} command ${input.commandId} could not be read back through sequence ${input.sequence}.`,
                    ),
                  );
            }),
          );

      return AdmittedWsFeatureRpcGroup.of({
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
          rpcEffect(
            Effect.gen(function* () {
              const { command: normalizedCommand, prepareWorkspaceRoot } =
                yield* normalizeDispatchCommand({ command });
              let authorizedCommand = normalizedCommand;
              if (Schema.is(SupervisedGovernanceCommand)(normalizedCommand)) {
                yield* requireOwnerSession;
                const actor = { kind: "user" as const, actorId: "owner" };
                if (
                  normalizedCommand.type === "supervised.supervisor.create" ||
                  normalizedCommand.type === "supervised.lead.enroll" ||
                  normalizedCommand.type === "supervised.lead.replace"
                ) {
                  const governance = yield* supervisedGovernanceRepository.getSnapshot();
                  const preset = governance.orchestration?.profiles.find(
                    (candidate) => candidate.id === normalizedCommand.profilePresetId,
                  );
                  if (!preset) {
                    return yield* Effect.fail(new Error("Supervised profile does not exist."));
                  }
                  const launchIssue = profileLaunchIssue(preset);
                  if (launchIssue !== null) {
                    return yield* Effect.fail(new Error(launchIssue));
                  }
                  const profileSnapshotId =
                    normalizedCommand.type === "supervised.supervisor.create"
                      ? normalizedCommand.supervisor.profileSnapshotId
                      : normalizedCommand.type === "supervised.lead.enroll"
                        ? normalizedCommand.lead.profileSnapshotId
                        : normalizedCommand.rotation.replacementProfileSnapshotId;
                  authorizedCommand = {
                    ...normalizedCommand,
                    actor,
                    ...(normalizedCommand.type === "supervised.lead.replace"
                      ? {
                          replacementProfileSnapshot: resolveProfilePreset({
                            preset,
                            snapshotId: profileSnapshotId,
                            createdAt: normalizedCommand.createdAt,
                          }),
                        }
                      : {
                          profileSnapshot: resolveProfilePreset({
                            preset,
                            snapshotId: profileSnapshotId,
                            createdAt: normalizedCommand.createdAt,
                          }),
                        }),
                  };
                } else {
                  authorizedCommand = { ...normalizedCommand, actor };
                }
              } else if (Schema.is(SupervisedCommand)(normalizedCommand)) {
                yield* requireOwnerSession;
                authorizedCommand = {
                  ...normalizedCommand,
                  actor: { kind: "user" as const, actorId: "owner" },
                };
              } else if (
                normalizedCommand.type === "thread.turn.start" &&
                normalizedCommand.supervisedBootstrap !== undefined
              ) {
                yield* requireOwnerSession;
                const governance = yield* supervisedGovernanceRepository.getSnapshot();
                const bootstrap = normalizedCommand.supervisedBootstrap;
                const preset = governance.orchestration?.profiles.find(
                  (candidate) => candidate.id === bootstrap.profilePresetId,
                );
                if (!preset) {
                  return yield* Effect.fail(new Error("Supervised profile does not exist."));
                }
                const launchIssue = profileLaunchIssue(preset);
                if (launchIssue !== null) {
                  return yield* Effect.fail(new Error(launchIssue));
                }
                const profileSnapshotId =
                  bootstrap.kind === "lead"
                    ? bootstrap.lead.profileSnapshotId
                    : bootstrap.supervisor.profileSnapshotId;
                authorizedCommand = {
                  ...normalizedCommand,
                  supervisedBootstrap: {
                    ...bootstrap,
                    profileSnapshot: resolveProfilePreset({
                      preset,
                      snapshotId: profileSnapshotId,
                      createdAt: normalizedCommand.createdAt,
                    }),
                  },
                };
              }
              if (
                normalizedCommand.type === "thread.handoff.create" &&
                normalizedCommand.handoffAttemptId !== undefined
              ) {
                if (normalizedCommand.handoffDestinationMode === undefined) {
                  return yield* Effect.fail(
                    new Error("Cross-mode handoff destination mode is required."),
                  );
                }
                const crossModeHandoff = yield* handoffPreparation.accept({
                  attemptId: normalizedCommand.handoffAttemptId,
                  destinationThreadId: normalizedCommand.threadId,
                  destinationMode: normalizedCommand.handoffDestinationMode,
                  projectId: normalizedCommand.projectId,
                  sourceLinkOnly: normalizedCommand.handoffSourceLinkOnly === true,
                });
                if (crossModeHandoff.grant.sourceThreadId !== normalizedCommand.sourceThreadId) {
                  return yield* Effect.fail(
                    new Error("The handoff attempt belongs to another source thread."),
                  );
                }
                authorizedCommand = { ...normalizedCommand, crossModeHandoff };
              } else if (
                normalizedCommand.type === "thread.handoff.create" &&
                normalizedCommand.crossModeHandoff !== undefined
              ) {
                return yield* Effect.fail(
                  new Error(
                    "Cross-mode handoff authority must be resolved from a server preparation attempt.",
                  ),
                );
              }
              const result = yield* dispatchOrchestrationCommand(authorizedCommand);
              // Only scaffold managed workspace-root subdirectories (Inbox/Outbox/work/outputs)
              // AFTER the decider has accepted the command. A rejected dispatch (e.g. a
              // cross-kind workspace-root ownership conflict) must never mutate the filesystem.
              if (prepareWorkspaceRoot) {
                yield* prepareWorkspaceRoot;
              }
              if (authorizedCommand.type === "thread.archive") {
                yield* Effect.forkDetach(pruneManagedWorktrees);
              }
              return result;
            }),
            "Failed to dispatch orchestration command",
          ),
        [ORCHESTRATION_WS_METHODS.importThread]: (input) =>
          rpcEffect(importThread(input), "Failed to import thread"),
        [ORCHESTRATION_WS_METHODS.getSnapshot]: () =>
          rpcEffect(
            projectionReadModelQuery.getSnapshot(),
            "Failed to load orchestration snapshot",
          ),
        [ORCHESTRATION_WS_METHODS.getSupervisedRuntime]: (input) =>
          rpcEffect(
            requireOwnerSession.pipe(
              Effect.andThen(supervisedRuntimeRepository.getSnapshot(input)),
            ),
            "Failed to load Supervised runtime",
          ),
        [ORCHESTRATION_WS_METHODS.getSupervisedSettings]: () =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              const [governance, runtime, policies, receipts] = yield* Effect.all([
                supervisedGovernanceRepository.getSnapshot(),
                supervisedRuntimeRepository.getSnapshot({ includeDisabled: true, limit: 500 }),
                supervisedToolPolicyRepository.list(),
                supervisedToolReceiptRepository.listRecent(500),
              ]);
              const now = new Date().toISOString();
              const tools = projectSupervisedSystemTools({
                definitions: hostToolRuntime.catalog,
                policies,
                receipts,
                authorityReceipts: governance.authorityReceipts,
                defaultUpdatedAt: governance.updatedAt,
                at: now,
              });
              return { governance, runtime, tools, updatedAt: now };
            }),
            "Failed to load Supervised settings",
          ),
        [ORCHESTRATION_WS_METHODS.putSupervisedModelCapabilityProfile]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              const catalog = yield* providerDiscoveryService
                .listModels({ provider: input.profile.provider as ProviderKind })
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning(
                      "provider model discovery unavailable during owner-curated capability ingestion",
                      { provider: input.profile.provider, error },
                    ).pipe(Effect.as(null)),
                  ),
                );
              const prepared = yield* Effect.try({
                try: () =>
                  prepareOwnerCuratedModelCapabilityProfile({
                    profile: input.profile,
                    catalog,
                    updatedAt: new Date().toISOString(),
                  }),
                catch: (error) => (error instanceof Error ? error : new Error(String(error))),
              });
              const profile = yield* modelRoutingService.putCapabilityProfile({
                profile: prepared.profile,
                expectedRevision: input.expectedRevision,
              });
              const state = yield* modelRoutingService.getState("owner");
              return {
                profile,
                routingRevision: state.routingRevision,
                catalogStatus: prepared.catalogStatus,
                catalogSource: prepared.catalogSource,
              };
            }),
            "Failed to save the owner-curated model capability profile",
          ),
        [ORCHESTRATION_WS_METHODS.putSupervisedModelPreferences]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              if (input.profile.userId !== "owner") {
                return yield* Effect.fail(
                  new Error("Supervised Settings can only update the owner's preference profile."),
                );
              }
              const profile = yield* modelRoutingService.putUserPreferenceProfile(input);
              const state = yield* modelRoutingService.getState(profile.userId);
              return { profile, routingRevision: state.routingRevision };
            }),
            "Failed to save Supervised model preferences",
          ),
        [ORCHESTRATION_WS_METHODS.updateSupervisedToolPolicy]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              if (
                !supervisedIntentToolRegistry.some((descriptor) => descriptor.id === input.toolId)
              ) {
                return yield* Effect.fail(new Error(`Unknown Supervised tool '${input.toolId}'.`));
              }
              const now = new Date().toISOString();
              const policy: SupervisedToolPolicy = {
                toolId: input.toolId,
                state: input.state,
                revision: input.expectedRevision + 1,
                reason: input.reason,
                updatedAt: now,
                revokedAt: input.state === "revoked" ? now : null,
              };
              const saved = yield* supervisedToolPolicyRepository.put({
                policy,
                expectedRevision: input.expectedRevision,
                audit: {
                  action: "tool.policy.update",
                  actor: { kind: "user", actorId: "owner" },
                  targetKind: "supervised-tool",
                  targetId: input.toolId,
                  outcome: "succeeded",
                  detail: {
                    state: input.state,
                    revision: policy.revision,
                    reason: input.reason,
                  },
                  occurredAt: now,
                },
              });
              return { policy: saved };
            }),
            "Failed to update Supervised tool policy",
          ),
        [ORCHESTRATION_WS_METHODS.testSupervisedSubscription]: (input) =>
          rpcEffect(
            Effect.sync(() => {
              const result = evaluateSyntheticSubscriptionTest(
                input.subscription,
                input.syntheticEvent,
              );
              return {
                matched: result.matched,
                wouldTrigger: result.triggeredSignals.length > 0,
                reasons: [...result.reasons],
                hypotheticalSignal: result.triggeredSignals[0] ?? null,
                productionActionExecuted: false as const,
              };
            }),
            "Failed to test Supervised subscription",
          ),
        [ORCHESTRATION_WS_METHODS.inspectSupervisedPlugin]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              return yield* Effect.tryPromise(() =>
                inspectSupervisedPluginPackage(input.directory),
              );
            }),
            "Failed to inspect Supervised plugin",
          ),
        [ORCHESTRATION_WS_METHODS.installSupervisedPlugin]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              const inspection = yield* Effect.tryPromise(() =>
                inspectSupervisedPluginPackage(input.directory),
              );
              const requestedCapabilities = new Set(inspection.manifest.requestedCapabilities);
              if (input.capabilities.some((capability) => !requestedCapabilities.has(capability))) {
                return yield* Effect.fail(
                  new Error("Selected plugin capabilities exceed the inspected manifest."),
                );
              }
              const requestedFields = new Set(inspection.manifest.requestedPayloadFields);
              if (input.payloadFields.some((field) => !requestedFields.has(field))) {
                return yield* Effect.fail(
                  new Error("Selected plugin payload fields exceed the inspected manifest."),
                );
              }
              const secretFields = new Set(
                inspection.manifest.eventSchemas.flatMap((schema) =>
                  Object.entries(schema.fieldClassifications)
                    .filter(([, classification]) => classification === "secret")
                    .map(([field]) => field),
                ),
              );
              if (input.payloadFields.some((field) => secretFields.has(field))) {
                return yield* Effect.fail(
                  new Error("Secret EventSchema fields cannot be granted to a plugin."),
                );
              }
              const requestedActions = new Set(inspection.requestedActionRequests);
              if (input.allowedActionRequests.some((action) => !requestedActions.has(action))) {
                return yield* Effect.fail(
                  new Error("Selected plugin actions exceed its declared subscriptions."),
                );
              }
              const snapshot = yield* supervisedRuntimeRepository.getDaemonSnapshot();
              const current = snapshot.plugins.find(
                (plugin) => plugin.pluginId === inspection.manifest.pluginId,
              );
              if (current?.status === "revoked") {
                return yield* Effect.fail(
                  new Error("This plugin identity was revoked and cannot be reactivated."),
                );
              }
              const collidingSubscription = inspection.manifest.subscriptions.find((declared) => {
                const existing = snapshot.subscriptions.find(
                  (subscription) => subscription.id === declared.id,
                );
                return (
                  existing !== undefined &&
                  (existing.destination.kind !== "plugin" ||
                    existing.destination.pluginId !== inspection.manifest.pluginId)
                );
              });
              if (collidingSubscription) {
                return yield* Effect.fail(
                  new Error(
                    `Plugin subscription '${collidingSubscription.id}' conflicts with a subscription owned by another runtime concern.`,
                  ),
                );
              }
              const now = new Date().toISOString();
              const samePackage =
                current !== undefined &&
                current.manifest.version === inspection.manifest.version &&
                current.manifest.provenance.contentHash ===
                  inspection.manifest.provenance.contentHash;
              const sameGrant =
                current !== undefined &&
                sameStringSet(current.grant.capabilities, input.capabilities) &&
                sameStringSet(current.grant.payloadFields, input.payloadFields) &&
                sameScopeSet(current.grant.scopes, input.scopes) &&
                sameStringSet(current.grant.allowedActionRequests, input.allowedActionRequests);
              if (samePackage && !sameGrant) {
                return yield* Effect.fail(
                  new Error(
                    "An identical plugin package is already installed with a different grant; publish a new package version before replacing its grant.",
                  ),
                );
              }
              let installation = Schema.decodeUnknownSync(PluginInstallation)({
                pluginId: inspection.manifest.pluginId,
                manifest: inspection.manifest,
                grant: {
                  id: `plugin-grant:${randomUUID()}`,
                  pluginId: inspection.manifest.pluginId,
                  capabilities: input.capabilities,
                  payloadFields: input.payloadFields,
                  scopes: input.scopes,
                  allowedActionRequests: input.allowedActionRequests,
                  status: "active",
                  grantedBy: { kind: "user", actorId: "owner" },
                  grantedAt: now,
                  revokedAt: null,
                  revision: current ? current.grant.revision + 1 : 0,
                },
                status: current ? "disabled" : "installed",
                installedAt: current?.installedAt ?? now,
                updatedAt: now,
                revision: current ? current.revision + 1 : 0,
              });
              let sequence = yield* orchestrationEngine.getEventHighWaterSequence;
              if (samePackage && current) {
                installation = current;
                if (current.status === "enabled" || current.status === "unhealthy") {
                  const disableResult = yield* orchestrationEngine.dispatch({
                    type: "supervised.plugin.disable",
                    commandId: CommandId.makeUnsafe(`plugin-disable-for-upgrade:${randomUUID()}`),
                    actor: { kind: "user", actorId: "owner" },
                    aggregateId: current.pluginId,
                    expectedRevision: current.revision,
                    idempotencyKey: `plugin-disable-for-upgrade:${current.pluginId}:${current.manifest.provenance.contentHash}:${current.revision}`,
                    pluginId: current.pluginId,
                    createdAt: now,
                  });
                  sequence = disableResult.sequence;
                  installation = {
                    ...current,
                    status: "disabled",
                    updatedAt: now,
                    revision: current.revision + 1,
                  };
                }
              } else {
                const installationResult = yield* orchestrationEngine.dispatch({
                  type: current ? "supervised.plugin.upgrade" : "supervised.plugin.install",
                  commandId: CommandId.makeUnsafe(`plugin-install:${randomUUID()}`),
                  actor: { kind: "user", actorId: "owner" },
                  aggregateId: installation.pluginId,
                  expectedRevision: current?.revision ?? 0,
                  idempotencyKey: `plugin-install:${installation.pluginId}:${installation.manifest.provenance.contentHash}`,
                  createdAt: now,
                  installation,
                });
                sequence = installationResult.sequence;
              }
              yield* Effect.forEach(
                inspection.manifest.eventSchemas,
                supervisedRuntimeRepository.upsertEventSchema,
                { concurrency: 1, discard: true },
              );
              const declaredSubscriptionIds = new Set(
                inspection.manifest.subscriptions.map((subscription) => subscription.id),
              );
              const removedSubscriptions = snapshot.subscriptions.filter(
                (subscription) =>
                  subscription.destination.kind === "plugin" &&
                  subscription.destination.pluginId === installation.pluginId &&
                  subscription.state !== "revoked" &&
                  !declaredSubscriptionIds.has(subscription.id),
              );
              yield* Effect.forEach(
                removedSubscriptions,
                (subscription) => {
                  const expectedRevision = subscription.revision;
                  return orchestrationEngine.dispatch({
                    type: "supervised.subscription.revoke",
                    commandId: CommandId.makeUnsafe(`plugin-subscription-revoke:${randomUUID()}`),
                    actor: { kind: "user", actorId: "owner" },
                    aggregateId: subscription.id,
                    expectedRevision,
                    idempotencyKey: pluginInstallStepIdempotencyKey({
                      step: "plugin-subscription-revoke",
                      pluginId: installation.pluginId,
                      packageIdentity: installation.manifest.provenance.contentHash,
                      subscriptionId: subscription.id,
                      expectedRevision,
                    }),
                    subscriptionId: subscription.id,
                    createdAt: now,
                  });
                },
                { concurrency: 1, discard: true },
              );
              const preparedSubscriptions = inspection.manifest.subscriptions.map(
                (declaredSubscription) => {
                  const existing = snapshot.subscriptions.find(
                    (subscription) => subscription.id === declaredSubscription.id,
                  );
                  return {
                    ...declaredSubscription,
                    owner: { kind: "user" as const, actorId: "owner" },
                    cursor: existing?.cursor ?? {
                      lastSequence: 0,
                      lastEventTime: null,
                      lastDeliveryKey: null,
                    },
                    state: "paused" as const,
                    armed: input.enableAfterInstall,
                    createdBy: existing?.createdBy ?? { kind: "user" as const, actorId: "owner" },
                    updatedBy: { kind: "user" as const, actorId: "owner" },
                    createdAt: existing?.createdAt ?? now,
                    updatedAt: now,
                    revision: existing?.revision ?? 0,
                  };
                },
              );
              yield* Effect.forEach(
                preparedSubscriptions,
                (subscription) => {
                  const existing = snapshot.subscriptions.find(
                    (candidate) => candidate.id === subscription.id,
                  );
                  const expectedRevision = existing?.revision ?? 0;
                  return orchestrationEngine.dispatch({
                    type: "supervised.subscription.upsert",
                    commandId: CommandId.makeUnsafe(`plugin-subscription:${randomUUID()}`),
                    actor: { kind: "user", actorId: "owner" },
                    aggregateId: subscription.id,
                    expectedRevision,
                    idempotencyKey: pluginInstallStepIdempotencyKey({
                      step: "plugin-subscription",
                      pluginId: installation.pluginId,
                      packageIdentity: installation.manifest.provenance.contentHash,
                      subscriptionId: subscription.id,
                      expectedRevision,
                    }),
                    subscription,
                    createdAt: now,
                  });
                },
                { concurrency: 1, discard: true },
              );
              let finalInstallation = installation;
              if (current) {
                const resetResult = yield* orchestrationEngine.dispatch({
                  type: "supervised.plugin.reset-circuit",
                  commandId: CommandId.makeUnsafe(`plugin-reset-circuit:${randomUUID()}`),
                  actor: { kind: "user", actorId: "owner" },
                  aggregateId: installation.pluginId,
                  expectedRevision: installation.revision,
                  idempotencyKey: pluginInstallStepIdempotencyKey({
                    step: "plugin-reset-circuit",
                    pluginId: installation.pluginId,
                    packageIdentity: installation.manifest.provenance.contentHash,
                    expectedRevision: installation.revision,
                  }),
                  pluginId: installation.pluginId,
                  createdAt: now,
                });
                sequence = resetResult.sequence;
              }
              if (input.enableAfterInstall) {
                const enableResult = yield* orchestrationEngine.dispatch({
                  type: "supervised.plugin.enable",
                  commandId: CommandId.makeUnsafe(`plugin-enable:${randomUUID()}`),
                  actor: { kind: "user", actorId: "owner" },
                  aggregateId: installation.pluginId,
                  expectedRevision: installation.revision,
                  idempotencyKey: pluginInstallStepIdempotencyKey({
                    step: "plugin-enable",
                    pluginId: installation.pluginId,
                    packageIdentity: installation.manifest.provenance.contentHash,
                    expectedRevision: installation.revision,
                  }),
                  pluginId: installation.pluginId,
                  createdAt: now,
                });
                sequence = enableResult.sequence;
                finalInstallation = {
                  ...installation,
                  status: "enabled",
                  revision: installation.revision + 1,
                };
                for (const subscription of preparedSubscriptions) {
                  const existing = snapshot.subscriptions.find(
                    (candidate) => candidate.id === subscription.id,
                  );
                  const expectedRevision = existing ? existing.revision + 1 : subscription.revision;
                  const enableSubscriptionResult = yield* orchestrationEngine.dispatch({
                    type: "supervised.subscription.enable",
                    commandId: CommandId.makeUnsafe(`plugin-subscription-enable:${randomUUID()}`),
                    actor: { kind: "user", actorId: "owner" },
                    aggregateId: subscription.id,
                    expectedRevision,
                    idempotencyKey: pluginInstallStepIdempotencyKey({
                      step: "plugin-subscription-enable",
                      pluginId: installation.pluginId,
                      packageIdentity: installation.manifest.provenance.contentHash,
                      subscriptionId: subscription.id,
                      expectedRevision,
                    }),
                    subscriptionId: subscription.id,
                    createdAt: now,
                  });
                  sequence = enableSubscriptionResult.sequence;
                }
              }
              return {
                installation: finalInstallation,
                sequence,
                operation: current ? ("upgraded" as const) : ("installed" as const),
              };
            }),
            "Failed to install Supervised plugin",
          ),
        [ORCHESTRATION_WS_METHODS.reconcileSupervisedRuntime]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              yield* requireOwnerSession;
              const health =
                input.restart === true
                  ? yield* supervisedRuntimeDaemon.restart
                  : yield* supervisedRuntimeDaemon.reconcile.pipe(
                      Effect.andThen(
                        supervisedRuntimeRepository.getSnapshot({ includeDisabled: true }),
                      ),
                      Effect.map((snapshot) => snapshot.health),
                    );
              yield* supervisedRuntimeRepository.appendAudit({
                action: input.restart === true ? "daemon.restart" : "daemon.reconcile",
                actor: { kind: "user", actorId: "owner" },
                targetKind: "supervised-runtime",
                targetId: "daemon",
                outcome: "succeeded",
                detail: {
                  daemonEpoch: health.daemonEpoch,
                  status: health.status,
                  journalLag: health.journalLag,
                  deliveryQueueDepth: health.deliveryQueueDepth,
                  deadLetterCount: health.deadLetterCount,
                },
                occurredAt: new Date().toISOString(),
              });
              return health;
            }),
            "Failed to reconcile Supervised runtime",
          ),
        [ORCHESTRATION_WS_METHODS.getShellSnapshot]: () =>
          rpcEffect(
            projectionReadModelQuery.getShellSnapshot(),
            "Failed to load orchestration shell snapshot",
          ),
        [ORCHESTRATION_WS_METHODS.getThreadDetailSnapshot]: (input) =>
          rpcEffect(
            projectionReadModelQuery
              .getThreadDetailSnapshotById(input.threadId)
              .pipe(Effect.map(Option.getOrNull)),
            "Failed to load orchestration thread detail snapshot",
          ),
        [ORCHESTRATION_WS_METHODS.repairState]: () =>
          rpcEffect(orchestrationEngine.repairState(), "Failed to repair orchestration state"),
        [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
          rpcEffect(checkpointDiffQuery.getTurnDiff(input), "Failed to load turn diff"),
        [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
          rpcEffect(
            checkpointDiffQuery.getFullThreadDiff(input),
            "Failed to load full thread diff",
          ),
        [ORCHESTRATION_WS_METHODS.replayEvents]: (input) => {
          const fromSequenceExclusive = clamp(input.fromSequenceExclusive, {
            maximum: Number.MAX_SAFE_INTEGER,
            minimum: 0,
          });
          const replay =
            input.threadId === undefined
              ? orchestrationEngine.readEvents(fromSequenceExclusive)
              : orchestrationEngine.readThreadEvents(
                  input.threadId,
                  fromSequenceExclusive,
                  THREAD_DETAIL_EVENT_TYPES,
                );
          return rpcEffect(
            Stream.runCollect(replay).pipe(Effect.map((events) => Array.from(events))),
            "Failed to replay orchestration events",
          );
        },
        [ORCHESTRATION_WS_METHODS.listProviderDeliveryBlockers]: (input) =>
          rpcEffect(
            providerCommandReactor.listBlockingDeliveries({
              ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
              limit: input.limit ?? 50,
            }),
            "Failed to load provider delivery blockers",
          ),
        [ORCHESTRATION_WS_METHODS.reconcileProviderDelivery]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              const principal = yield* CurrentManagedAttachmentPrincipal;
              const result = yield* providerCommandReactor.reconcileDelivery({
                eventSequence: input.eventSequence,
                threadId: input.threadId,
                expectedState: input.expectedState,
                outcome: input.outcome,
                reconciledBy: `${principal.ownerKind}:${principal.ownerId}`,
                ...(input.note === undefined ? {} : { note: input.note }),
              });
              if (result === null) {
                return yield* new WsRpcError({
                  message:
                    "Provider delivery no longer matches the requested thread and blocking state.",
                  code: "PROVIDER_DELIVERY_RECONCILIATION_CONFLICT",
                  retryable: false,
                });
              }
              return result;
            }),
            "Failed to reconcile provider delivery",
          ),
        [ORCHESTRATION_WS_METHODS.startHandoffPreparation]: (input) =>
          rpcEffect(handoffPreparation.start(input), "Failed to start handoff preparation"),
        [ORCHESTRATION_WS_METHODS.getHandoffPreparation]: (input) =>
          rpcEffect(handoffPreparation.get(input), "Failed to read handoff preparation"),
        [ORCHESTRATION_WS_METHODS.cancelHandoffPreparation]: (input) =>
          rpcEffect(handoffPreparation.cancel(input), "Failed to cancel handoff preparation"),
        [ORCHESTRATION_WS_METHODS.listHandoffGrants]: () =>
          rpcEffect(
            projectionReadModelQuery.getSnapshot().pipe(
              Effect.map((snapshot) => ({
                items: snapshot.threads.flatMap((thread) => {
                  const grant = thread.handoff?.crossMode?.grant;
                  return grant ? [grant] : [];
                }),
              })),
            ),
            "Failed to list handoff grants",
          ),
        [ORCHESTRATION_WS_METHODS.revokeHandoffGrant]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              const snapshot = yield* projectionReadModelQuery.getSnapshot();
              const thread = snapshot.threads.find(
                (candidate) => candidate.handoff?.crossMode?.grant.grantId === input.grantId,
              );
              if (!thread?.handoff?.crossMode) return { revoked: false };
              const now = new Date().toISOString();
              yield* dispatchOrchestrationCommand({
                type: "thread.meta.update",
                commandId: CommandId.makeUnsafe(randomUUID()),
                threadId: thread.id,
                handoff: {
                  ...thread.handoff,
                  crossMode: {
                    ...thread.handoff.crossMode,
                    grant: {
                      ...thread.handoff.crossMode.grant,
                      status: "revoked",
                      revision: thread.handoff.crossMode.grant.revision + 1,
                      revokedAt: now,
                    },
                  },
                },
              });
              return { revoked: true };
            }),
            "Failed to revoke handoff grant",
          ),
        [ORCHESTRATION_WS_METHODS.listTaskProcesses]: (input) =>
          rpcEffect(taskProcessQuery.listProcesses(input), "Failed to list TaskProcesses"),
        [ORCHESTRATION_WS_METHODS.getTaskProcessSummary]: (input) =>
          rpcEffect(taskProcessQuery.getSummary(input), "Failed to load TaskProcess summary"),
        [ORCHESTRATION_WS_METHODS.getTaskProcessGraph]: (input) =>
          rpcEffect(taskProcessQuery.getGraph(input), "Failed to load TaskProcess graph"),
        [ORCHESTRATION_WS_METHODS.getSessionProgress]: (input) =>
          rpcEffect(taskProcessQuery.getSessionProgress(input), "Failed to load session progress"),
        [ORCHESTRATION_WS_METHODS.dispatchTaskProcessCommand]: (input) =>
          rpcEffect(
            requireOwnerSession.pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  const command = input.command;
                  const process = yield* taskProcessProjections.getProcess(command.processId);
                  if (command.type === "task-process.create") {
                    if (command.owner.kind !== "user") {
                      return yield* Effect.fail(
                        new Error(
                          "Human NativeApi callers may create only user-owned TaskProcesses.",
                        ),
                      );
                    }
                  } else if (Option.isNone(process)) {
                    return yield* Effect.fail(
                      new Error(`TaskProcess '${command.processId}' was not found.`),
                    );
                  } else {
                    if (process.value.process.projectId !== command.projectId) {
                      return yield* Effect.fail(new Error("TaskProcess project scope mismatch."));
                    }
                  }
                  const result = yield* dispatchOrchestrationCommand({
                    ...command,
                    actor: { kind: "user" as const, actorId: "owner" },
                    ...(command.type === "task-process.create"
                      ? { owner: { kind: "user" as const } }
                      : {}),
                  });
                  const event = yield* readAcceptedAggregateEvent({
                    aggregateKind: "task_process",
                    aggregateId: command.processId,
                    commandId: command.commandId,
                    sequence: result.sequence,
                  });
                  if (!Schema.is(TaskProcessDomainEvent)(event)) {
                    return yield* Effect.fail(
                      new Error("Accepted event is not a TaskProcess event."),
                    );
                  }
                  return { sequence: event.sequence, mutation: event.payload.mutation };
                }),
              ),
            ),
            "Failed to dispatch TaskProcess command",
          ),
        [ORCHESTRATION_WS_METHODS.subscribeShell]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "orchestration.shell" },
            makeCursorSafeSnapshotLiveStream({
              subscribeLive: orchestrationEngine.subscribeDomainEvents.pipe(
                Effect.map((stream) =>
                  bufferLiveUiStream(stream.pipe(Stream.filter(isShellRelevantEvent)), {
                    label: "orchestration.shell",
                    onDroppedEvents: failLiveUiStreamForSnapshotResync,
                  }),
                ),
              ),
              snapshot: projectionReadModelQuery
                .getShellSnapshot()
                .pipe(
                  Effect.mapError((cause) => toWsRpcError(cause, "Failed to load shell snapshot")),
                ),
              snapshotSequence: (snapshot) => snapshot.snapshotSequence,
              getHighWaterSequence: getOrchestrationHighWaterSequence,
              replay: (fromSequenceExclusive, throughSequenceInclusive) =>
                orchestrationEngine
                  .readEventsThrough(fromSequenceExclusive, throughSequenceInclusive)
                  .pipe(
                    Stream.filter(isShellRelevantEvent),
                    Stream.mapError((cause) =>
                      toWsRpcError(cause, "Failed to replay shell events"),
                    ),
                  ),
            }).pipe(
              Stream.mapEffect((item) =>
                item.kind === "snapshot"
                  ? Effect.succeed(
                      Option.some<OrchestrationShellStreamItem>({
                        kind: "snapshot",
                        snapshot: item.snapshot,
                      }),
                    )
                  : toShellStreamEvent(item.event),
              ),
              Stream.flatMap((item) =>
                Option.isSome(item) ? Stream.succeed(item.value) : Stream.empty,
              ),
            ),
          ),
        [ORCHESTRATION_WS_METHODS.unsubscribeShell]: () => Effect.void,
        [ORCHESTRATION_WS_METHODS.subscribeThread]: (input, { clientId }) =>
          streamAdmission.guard(
            clientId,
            {
              key: `orchestration.thread:${input.threadId}`,
              threadId: input.threadId,
            },
            makeCursorSafeSnapshotLiveStream({
              // Cursor resume: a client holding cached detail replays only the
              // gap. Out-of-range cursors (negative or overflowing gap) fall
              // back to the snapshot inside the stream factory.
              resumeFromSequence: input.afterSequence,
              // A hard-purged thread leaves no rows to replay while the journal
              // head stays above the cursor, so the gap check alone would
              // accept the resume and stream nothing. Falling through to the
              // snapshot path surfaces THREAD_SNAPSHOT_NOT_FOUND instead.
              // The shell read shares the detail loader's active-thread
              // predicate but skips hydrating and validating the transcript,
              // which the resume path would discard for a boolean anyway.
              resumeSubjectExists: projectionReadModelQuery.getThreadShellById(input.threadId).pipe(
                Effect.map(Option.isSome),
                Effect.mapError((cause) =>
                  toWsRpcError(cause, "Failed to verify thread before cursor resume"),
                ),
              ),
              onResnapshotRequired: (report) =>
                recordThreadResnapshotRequired(input.threadId, report),
              subscribeLive: orchestrationEngine.subscribeDomainEvents.pipe(
                Effect.map((stream) =>
                  bufferLiveUiStream(
                    stream.pipe(
                      Stream.filter((event) => isThreadDetailEventFor(event, input.threadId)),
                    ),
                    {
                      label: "orchestration.thread-detail",
                      onDroppedEvents: (report) => recordThreadStreamDrop(input.threadId, report),
                    },
                  ),
                ),
              ),
              snapshot: loadThreadDetailSnapshotWithBootstrapWait(input.threadId).pipe(
                Effect.flatMap(
                  Option.match({
                    onNone: () =>
                      projectionReadModelQuery.getSnapshotSequence().pipe(
                        Effect.map(({ snapshotSequence }) => ({
                          detail: Option.none<OrchestrationThreadDetailSnapshot>(),
                          snapshotSequence,
                        })),
                      ),
                    onSome: (detail) =>
                      Effect.succeed({
                        detail: Option.some(detail),
                        snapshotSequence: detail.snapshotSequence,
                      }),
                  }),
                ),
                Effect.mapError((cause) => toWsRpcError(cause, "Failed to load thread snapshot")),
              ),
              snapshotSequence: (snapshot) => snapshot.snapshotSequence,
              getHighWaterSequence: getOrchestrationHighWaterSequence,
              replay: (fromSequenceExclusive, throughSequenceInclusive) =>
                orchestrationEngine
                  .readThreadEventsThrough(
                    input.threadId,
                    fromSequenceExclusive,
                    throughSequenceInclusive,
                    THREAD_DETAIL_EVENT_TYPES,
                  )
                  .pipe(
                    Stream.filter((event) => isThreadDetailEventFor(event, input.threadId)),
                    Stream.mapError((cause) =>
                      toWsRpcError(cause, "Failed to replay thread events"),
                    ),
                  ),
            }).pipe(
              Stream.flatMap((item) => {
                if (item.kind === "event") {
                  return Stream.succeed<OrchestrationThreadStreamItem>({
                    kind: "event",
                    event: item.event,
                  });
                }
                // A silently empty snapshot would leave the client waiting forever
                // for thread history; fail identifiably so it can surface the state.
                return Option.isSome(item.snapshot.detail)
                  ? Stream.succeed<OrchestrationThreadStreamItem>({
                      kind: "snapshot",
                      snapshot: item.snapshot.detail.value,
                    })
                  : Stream.fail(
                      new WsRpcError({
                        message: `Thread detail snapshot not found for thread ${input.threadId}.`,
                        code: "THREAD_SNAPSHOT_NOT_FOUND",
                        retryable: false,
                      }),
                    );
              }),
            ),
          ),
        [ORCHESTRATION_WS_METHODS.unsubscribeThread]: () => Effect.void,
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (input, { clientId }) => {
          const afterSequence = input.afterSequence;
          return streamAdmission.guard(
            clientId,
            { key: "orchestration.domain-events" },
            bufferLiveUiStream(
              afterSequence === undefined
                ? orchestrationEngine.streamDomainEvents
                : Stream.unwrap(
                    Effect.gen(function* () {
                      const live = yield* orchestrationEngine.subscribeDomainEvents;
                      const highWater = yield* getOrchestrationHighWaterSequence;
                      const fromSequence = clamp(afterSequence, {
                        maximum: Number.MAX_SAFE_INTEGER,
                        minimum: 0,
                      });
                      return Stream.concat(
                        orchestrationEngine.readEventsThrough(fromSequence, highWater),
                        live.pipe(Stream.filter((event) => event.sequence > highWater)),
                      ).pipe(
                        Stream.mapError((cause) =>
                          toWsRpcError(cause, "Failed to resume orchestration domain events"),
                        ),
                      );
                    }),
                  ),
              {
                label: "orchestration.domain-events",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              },
            ),
          );
        },

        [WS_METHODS.projectsListDirectories]: (input) =>
          rpcEffect(
            workspaceEntries.listDirectories(input),
            "Failed to list workspace directories",
          ),
        [WS_METHODS.projectsSearchEntries]: (input) =>
          rpcEffect(workspaceEntries.search(input), "Failed to search workspace entries"),
        [WS_METHODS.projectsDiscoverScripts]: (input) =>
          rpcEffect(workspaceEntries.discoverScripts(input), "Failed to discover project scripts"),
        [WS_METHODS.projectsSearchLocalEntries]: (input) =>
          rpcEffect(workspaceEntries.searchLocal(input), "Failed to search local entries"),
        [WS_METHODS.projectsReadFile]: (input) =>
          rpcEffect(workspaceFileSystem.readFile(input), "Failed to read workspace file"),
        [WS_METHODS.projectsResolveOutOfRootFileReference]: (input) =>
          rpcEffect(
            Effect.promise(async () => ({
              fullPath: await resolveOutOfRootFileReference({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                homeDir: config.homeDir,
              }),
            })),
            "Failed to resolve file reference outside the workspace",
          ),
        [WS_METHODS.projectsCreateLocalFilePreviewGrant]: (input) =>
          rpcEffect(
            Effect.promise(() => createLocalPreviewGrant({ requestedPath: input.path })),
            "Failed to create local file preview grant",
          ),
        [WS_METHODS.projectsWriteFile]: (input) =>
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) =>
              cause instanceof WorkspaceFileConflictError
                ? new WsRpcError({
                    message: cause.message,
                    code: "WORKSPACE_FILE_CONFLICT",
                    retryable: false,
                  })
                : cause instanceof WorkspaceFileDeletedError
                  ? new WsRpcError({
                      message: cause.message,
                      code: "WORKSPACE_FILE_DELETED",
                      retryable: false,
                    })
                  : toWsRpcError(cause, "Failed to write workspace file"),
            ),
          ),
        [WS_METHODS.projectsRunDevServer]: (input) =>
          rpcEffect(devServerManager.run(input), "Failed to start dev server"),
        [WS_METHODS.projectsStopDevServer]: (input) =>
          rpcEffect(devServerManager.stop(input), "Failed to stop dev server"),
        [WS_METHODS.projectsListDevServers]: () =>
          rpcEffect(devServerManager.list, "Failed to list dev servers"),
        [WS_METHODS.subscribeProjectDevServerEvents]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "projects.dev-servers" },
            Stream.concat(
              Stream.fromEffect(
                devServerManager.list.pipe(
                  Effect.map(
                    (result): ProjectDevServerEvent => ({
                      type: "snapshot",
                      servers: result.servers,
                    }),
                  ),
                ),
              ),
              bufferLiveUiStream(devServerManager.stream, {
                label: "projects.dev-servers",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }),
            ),
          ),
        [WS_METHODS.projectsProvisionFromGitHub]: (input) =>
          bufferLiveUiStream(
            Stream.callback<GitHubProjectProvisionProgressEvent, WsRpcError>((queue) =>
              Effect.gen(function* () {
                const checkout = yield* githubProjectProvisioner.provisionCheckout(input, {
                  publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                });
                let registrationCommitted = false;
                const registerCheckout = Effect.gen(function* () {
                  yield* Queue.offer(queue, {
                    operationId: input.operationId,
                    kind: "phase",
                    phase: "registering",
                    message: "Adding project to Veylen",
                  });

                  const { command: normalizedCommand, prepareWorkspaceRoot } =
                    yield* normalizeDispatchCommand({
                      command: {
                        type: "project.create",
                        commandId: input.commandId,
                        projectId: input.projectId,
                        kind: "project",
                        title: path.basename(checkout.workspaceRoot),
                        workspaceRoot: checkout.workspaceRoot,
                        createWorkspaceRootIfMissing: false,
                        defaultModelSelection: input.defaultModelSelection,
                        spaceId: input.newProjectSpaceId,
                        createdAt: input.createdAt,
                      },
                    });
                  if (normalizedCommand.type !== "project.create") {
                    return yield* Effect.die(
                      new Error("GitHub project provisioning normalized an unexpected command"),
                    );
                  }

                  const existingProjectId = yield* findRegisteredProjectId(
                    normalizedCommand.workspaceRoot,
                  );
                  // Re-adding an existing checkout opens the existing project as-is. In
                  // particular, it must not silently move that project between Spaces;
                  // newProjectSpaceId applies only when project.create runs below.
                  const registration = existingProjectId
                    ? { projectId: existingProjectId, created: false }
                    : yield* dispatchOrchestrationCommand(normalizedCommand).pipe(
                        Effect.map(() => ({ projectId: input.projectId, created: true })),
                        Effect.catch((cause) =>
                          findRegisteredProjectId(normalizedCommand.workspaceRoot).pipe(
                            Effect.flatMap((racedProjectId) =>
                              racedProjectId
                                ? Effect.succeed({ projectId: racedProjectId, created: false })
                                : Effect.fail(cause),
                            ),
                          ),
                        ),
                      );
                  // This assignment is synchronous, so a pending interruption cannot run
                  // recovery between a successful dispatch and recording that fact.
                  registrationCommitted = true;
                  if (registration.created && prepareWorkspaceRoot) {
                    yield* prepareWorkspaceRoot;
                  }

                  return {
                    operationId: input.operationId,
                    repository: checkout.repository,
                    workspaceRoot: normalizedCommand.workspaceRoot,
                    projectId: registration.projectId,
                    checkout: checkout.checkout,
                  } as const;
                }).pipe(
                  Effect.onError(() =>
                    recoverUnregisteredGitHubCheckout({
                      checkout,
                      registrationCommitted,
                      moveWorkspaceRoot: (workspaceRoot, recoveryPath) =>
                        fileSystem.rename(workspaceRoot, recoveryPath),
                    }),
                  ),
                  // Promotion and registration form one critical section. If the client cancels
                  // after cloning, finish registration first so its workspace is never moved out
                  // from under a committed project. Recovery must share the same guarantee.
                  Effect.uninterruptible,
                );

                const result = yield* registerCheckout;
                yield* Queue.offer(queue, {
                  operationId: input.operationId,
                  kind: "completed",
                  result,
                });
                yield* Queue.end(queue);
              }).pipe(
                Effect.catch((cause) =>
                  Queue.fail(queue, toProjectProvisionRpcError(cause)).pipe(Effect.asVoid),
                ),
              ),
            ),
            { label: "projects.github-provision" },
          ),
        [WS_METHODS.filesystemBrowse]: (input) =>
          rpcEffect(workspaceEntries.browse(input), "Failed to browse filesystem"),
        [WS_METHODS.shellOpenInEditor]: (input) =>
          rpcEffect(open.openInEditor(input), "Failed to open editor"),

        [WS_METHODS.gitGithubRepository]: (input) =>
          rpcEffect(resolveGitHubRepository(git, input.cwd), "Failed to resolve GitHub repository"),
        [WS_METHODS.gitStatus]: (input) =>
          rpcEffect(gitStatusBroadcaster.getStatus(input), "Failed to read git status"),
        [WS_METHODS.gitReadWorkingTreeDiff]: (input) =>
          rpcEffect(gitManager.readWorkingTreeDiff(input), "Failed to read working tree diff"),
        [WS_METHODS.gitWorkingTreeDiffStats]: (input) =>
          rpcEffect(
            gitManager.readWorkingTreeDiffStats(input),
            "Failed to read working tree diff stats",
          ),
        [WS_METHODS.gitSummarizeDiff]: (input) =>
          rpcEffect(gitManager.summarizeDiff(input), "Failed to summarize diff"),
        [WS_METHODS.gitPull]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.pullCurrentBranch(input.cwd)),
            ),
            "Failed to pull branch",
          ),
        [WS_METHODS.gitRunStackedAction]: (input) =>
          bufferLiveUiStream(
            Stream.callback<GitActionProgressEvent, WsRpcError>((queue) =>
              gitManager
                .runStackedAction(input, {
                  actionId: input.actionId,
                  progressReporter: {
                    publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                  },
                })
                .pipe(
                  Effect.tap(() => refreshGitStatusInBackground(input.cwd)),
                  Effect.matchCauseEffect({
                    onFailure: (cause) =>
                      Queue.fail(queue, toWsRpcError(cause, "Git action failed")),
                    onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
                  }),
                ),
            ),
            { label: "git.stacked-action" },
          ),
        [WS_METHODS.gitResolvePullRequest]: (input) =>
          rpcEffect(gitManager.resolvePullRequest(input), "Failed to resolve pull request"),
        [WS_METHODS.gitPullRequestSnapshot]: (input) =>
          rpcEffect(
            gitManager.pullRequestSnapshot(input),
            "Failed to load pull request checks and comments",
          ),
        [WS_METHODS.gitPreparePullRequestThread]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, gitManager.preparePullRequestThread(input)),
            "Failed to prepare pull request thread",
          ),
        [WS_METHODS.pullRequestsList]: (input) =>
          pullRequestsEffect(pullRequests.list(input), "Failed to list pull requests"),
        [WS_METHODS.pullRequestsReviewRequestCount]: (input) =>
          pullRequestsEffect(
            pullRequests.reviewRequestCount(input),
            "Failed to count pull request review requests",
          ),
        [WS_METHODS.pullRequestsDetail]: (input) =>
          pullRequestsEffect(pullRequests.detail(input), "Failed to load pull request"),
        [WS_METHODS.pullRequestsDiff]: (input) =>
          pullRequestsEffect(pullRequests.diff(input), "Failed to load pull request diff"),
        [WS_METHODS.pullRequestsAction]: (input) =>
          pullRequestsEffect(pullRequests.action(input), "Pull request action failed"),
        [WS_METHODS.pullRequestsComment]: (input) =>
          pullRequestsEffect(pullRequests.comment(input), "Could not post the comment"),
        [WS_METHODS.pullRequestsSetPinned]: (input) =>
          rpcEffect(pullRequests.setPinned(input), "Failed to update pull request pin"),
        [WS_METHODS.gitListBranches]: (input) =>
          rpcEffect(git.listBranches(input), "Failed to list branches"),
        [WS_METHODS.gitCreateWorktree]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.createWorktree(input)),
            ),
            "Failed to create worktree",
          ),
        [WS_METHODS.gitCreateDetachedWorktree]: (input) =>
          bufferLiveUiStream(
            Stream.callback<GitWorktreeSetupProgressEvent, WsRpcError>((queue) => {
              const progressId = input.progressId ?? null;
              return refreshGitStatusAfter(
                input.cwd,
                git.withMutation(
                  input.cwd,
                  git.createDetachedWorktree(input, {
                    onPhase: (phase) =>
                      Queue.offer(queue, { kind: "phase_started", progressId, phase }).pipe(
                        Effect.asVoid,
                      ),
                  }),
                ),
              ).pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) =>
                    Queue.fail(queue, toWsRpcError(cause, "Failed to create detached worktree")),
                  onSuccess: (result) =>
                    Queue.offer(queue, { kind: "completed", progressId, result }).pipe(
                      Effect.andThen(Queue.end(queue)),
                      Effect.asVoid,
                    ),
                }),
              );
            }),
            { label: "git.create-detached-worktree" },
          ),
        [WS_METHODS.gitRemoveWorktree]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.removeWorktree(input)),
            ),
            "Failed to remove worktree",
          ),
        [WS_METHODS.gitCreateBranch]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, git.withMutation(input.cwd, git.createBranch(input))),
            "Failed to create branch",
          ),
        [WS_METHODS.gitCheckout]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, Effect.scoped(git.checkoutBranch(input))),
            ),
            "Failed to checkout branch",
          ),
        [WS_METHODS.gitStashAndCheckout]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, Effect.scoped(git.stashAndCheckout(input))),
            ),
            "Failed to stash and checkout",
          ),
        [WS_METHODS.gitStashDrop]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, git.withMutation(input.cwd, git.stashDrop(input))),
            "Failed to drop stash",
          ),
        [WS_METHODS.gitStashInfo]: (input) =>
          rpcEffect(git.stashInfo(input), "Failed to read stash"),
        [WS_METHODS.gitRemoveIndexLock]: (input) =>
          rpcEffect(
            git.withMutation(input.cwd, git.removeIndexLock(input)),
            "Failed to remove Git index lock",
          ),
        [WS_METHODS.gitInit]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(input.cwd, git.withMutation(input.cwd, git.initRepo(input))),
            "Failed to initialize repository",
          ),
        [WS_METHODS.gitStageFiles]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.stageFiles(input.cwd, input.paths)),
            ).pipe(Effect.as({ ok: true })),
            "Failed to stage files",
          ),
        [WS_METHODS.gitUnstageFiles]: (input) =>
          rpcEffect(
            refreshGitStatusAfter(
              input.cwd,
              git.withMutation(input.cwd, git.unstageFiles(input.cwd, input.paths)),
            ).pipe(Effect.as({ ok: true })),
            "Failed to unstage files",
          ),
        [WS_METHODS.gitHandoffThread]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              const { commandId, threadId, ...gitInput } = input;
              const operation = yield* beginGitHandoff(input);
              if (operation.phase === "pending" || operation.phase === "uncertain") {
                return yield* new WsRpcError({
                  message:
                    operation.phase === "pending"
                      ? "This Git handoff is already running."
                      : "This Git handoff was interrupted before its filesystem result became durable; inspect the repository before retrying.",
                });
              }
              if (operation.phase === "completed") return operation.result;

              const result =
                operation.phase === "git_applied"
                  ? operation.result
                  : yield* refreshGitStatusAfter(
                      input.cwd,
                      gitManager.handoffThread(gitInput).pipe(
                        Effect.catch((error) =>
                          discardPendingGitHandoff(commandId).pipe(
                            Effect.catch(() => Effect.void),
                            Effect.andThen(Effect.fail(error)),
                          ),
                        ),
                      ),
                    ).pipe(Effect.tap((gitResult) => recordGitHandoffResult(commandId, gitResult)));
              yield* dispatchOrchestrationCommand(
                gitHandoffMetadataCommand({ commandId, threadId }, result),
              );
              yield* completeGitHandoff(commandId);
              return result;
            }),
            "Failed to hand off thread",
          ),

        [WS_METHODS.terminalOpen]: (input) =>
          rpcEffect(
            resetTerminalTitleBuffer(input.threadId, input.terminalId ?? DEFAULT_TERMINAL_ID).pipe(
              Effect.andThen(terminalManager.open(input)),
            ),
            "Failed to open terminal",
          ),
        [WS_METHODS.terminalWrite]: (input) =>
          rpcEffect(
            terminalManager.write(input).pipe(
              Effect.tap(() =>
                maybeAutoRenameTerminalThread({
                  threadId: input.threadId,
                  terminalId: input.terminalId ?? DEFAULT_TERMINAL_ID,
                  data: input.data,
                }).pipe(Effect.catch(() => Effect.void)),
              ),
            ),
            "Failed to write terminal",
          ),
        [WS_METHODS.terminalAckOutput]: (input) =>
          rpcEffect(terminalManager.ackOutput(input), "Failed to acknowledge terminal output"),
        [WS_METHODS.terminalResize]: (input) =>
          rpcEffect(terminalManager.resize(input), "Failed to resize terminal"),
        [WS_METHODS.terminalClear]: (input) =>
          rpcEffect(terminalManager.clear(input), "Failed to clear terminal"),
        [WS_METHODS.terminalRestart]: (input) =>
          rpcEffect(
            resetTerminalTitleBuffer(input.threadId, input.terminalId ?? DEFAULT_TERMINAL_ID).pipe(
              Effect.andThen(terminalManager.restart(input)),
            ),
            "Failed to restart terminal",
          ),
        [WS_METHODS.terminalClose]: (input) =>
          rpcEffect(
            resetTerminalTitleBuffer(input.threadId, input.terminalId ?? null).pipe(
              Effect.andThen(terminalManager.close(input)),
            ),
            "Failed to close terminal",
          ),
        [WS_METHODS.subscribeTerminalEvents]: (_, { clientId }) =>
          // Terminal output is an ordered byte stream with renderer ACK accounting.
          // Keep this lossless: dropping chunks would create holes until reattach.
          streamAdmission.guard(
            clientId,
            { key: "terminal.events" },
            Stream.callback((queue) =>
              Effect.gen(function* () {
                const unsubscribe = yield* terminalManager.subscribe((event) => {
                  Effect.runFork(Queue.offer(queue, event).pipe(Effect.asVoid));
                });
                yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
              }),
            ),
          ),

        [WS_METHODS.serverGetConfig]: () =>
          rpcEffect(loadServerConfig, "Failed to load server config"),
        [WS_METHODS.serverGetEnvironment]: () =>
          rpcEffect(serverEnvironment.getDescriptor, "Failed to load server environment"),
        [WS_METHODS.serverGetSettings]: () =>
          rpcEffect(serverSettings.getSettingsView, "Failed to load server settings"),
        [WS_METHODS.serverUpdateSettings]: (input) =>
          rpcEffect(serverSettings.updateSettingsView(input), "Failed to update server settings"),
        [WS_METHODS.serverRefreshProviders]: () =>
          rpcEffect(
            providerHealth.refresh.pipe(Effect.map((providers) => ({ providers }))),
            "Failed to refresh providers",
          ),
        [WS_METHODS.serverUpdateProvider]: (input) => providerHealth.updateProvider(input),
        [WS_METHODS.serverListExternalMcpIntegrations]: () =>
          rpcEffect(
            requireOwner.pipe(Effect.andThen(externalMcp.listIntegrations())),
            "Failed to list external MCP integrations",
          ),
        [WS_METHODS.serverCreateExternalMcpIntegration]: (input) =>
          rpcEffect(
            requireOwner.pipe(Effect.andThen(externalMcp.createIntegration(input))),
            "Failed to create external MCP integration",
          ),
        [WS_METHODS.serverRevokeExternalMcpIntegration]: (input) =>
          rpcEffect(
            requireOwner.pipe(
              Effect.andThen(externalMcp.revokeIntegration(input.integrationId)),
              Effect.map((revoked) => ({ revoked })),
            ),
            "Failed to revoke external MCP integration",
          ),
        [WS_METHODS.serverRefreshExternalMcpPairing]: (input) =>
          rpcEffect(
            requireOwner.pipe(Effect.andThen(externalMcp.refreshPairing(input))),
            "Failed to refresh external MCP pairing",
          ),
        [WS_METHODS.serverListWorktrees]: () =>
          rpcEffect(
            pruneManagedWorktrees.pipe(Effect.map((worktrees) => ({ worktrees }))),
            "Failed to list managed worktrees",
          ),
        [WS_METHODS.serverListLocalServers]: () =>
          rpcEffect(
            Effect.promise(() => listLocalServers()),
            "Failed to list local servers",
          ),
        [WS_METHODS.serverStopLocalServer]: (input) =>
          rpcEffect(stopLocalServerAndTrackedProjectRun(input), "Failed to stop local server"),
        [WS_METHODS.statsGetProfileStats]: (input) =>
          rpcEffect(profileStatsQuery.getProfileStats(input), "Failed to load profile stats"),
        [WS_METHODS.statsGetProfileTokenStats]: (input) =>
          rpcEffect(
            profileStatsQuery.getProfileTokenStats(input),
            "Failed to load profile token stats",
          ),
        [WS_METHODS.serverGetProviderUsageSnapshot]: (input) =>
          rpcEffect(getProviderUsageSnapshot(input), "Failed to load provider usage"),
        [WS_METHODS.serverListProviderUsage]: (input) =>
          rpcEffect(listProviderUsage(input), "Failed to load provider usage"),
        [WS_METHODS.serverGetDiagnostics]: () =>
          rpcEffect(
            Effect.gen(function* () {
              const [projection, fullChildProcesses] = yield* Effect.all([
                projectionReadModelQuery.getCounts(),
                Effect.promise(() => readDescendantProcesses(process.pid)),
              ]);
              const memory = process.memoryUsage();
              const diagnostics: ServerDiagnosticsResult = {
                generatedAt: new Date().toISOString(),
                logsDirectory: config.logsDir,
                serverLogPath: config.serverLogPath,
                process: {
                  pid: process.pid,
                  uptimeSeconds: Math.max(0, Math.round(process.uptime())),
                  memory: {
                    rssBytes: Math.max(0, Math.round(memory.rss)),
                    heapTotalBytes: Math.max(0, Math.round(memory.heapTotal)),
                    heapUsedBytes: Math.max(0, Math.round(memory.heapUsed)),
                    externalBytes: Math.max(0, Math.round(memory.external)),
                    arrayBuffersBytes: Math.max(0, Math.round(memory.arrayBuffers)),
                  },
                },
                childProcesses: fullChildProcesses.slice(0, MAX_DIAGNOSTIC_CHILD_PROCESSES),
                childProcessTotalCount: fullChildProcesses.length,
                childProcessTotalRssBytes: fullChildProcesses.reduce(
                  (total, processRow) => total + processRow.rssBytes,
                  0,
                ),
                projection,
              };
              return diagnostics;
            }),
            "Failed to load server diagnostics",
          ),
        [WS_METHODS.serverPrewarmVoice]: (input) =>
          rpcEffect(
            providerAdapterRegistry
              .getByProvider(input.provider)
              .pipe(
                Effect.flatMap((adapter) =>
                  adapter.prewarmVoice
                    ? adapter.prewarmVoice(input)
                    : Effect.fail(
                        new Error(
                          `Voice transcription is unavailable for provider '${input.provider}'.`,
                        ),
                      ),
                ),
              ),
            "Voice transcription prewarm failed",
          ),
        [WS_METHODS.serverTranscribeVoice]: (input) =>
          rpcEffect(
            voiceUploadAdmissionGate.run(
              providerAdapterRegistry
                .getByProvider(input.provider)
                .pipe(
                  Effect.flatMap((adapter) =>
                    adapter.transcribeVoice
                      ? adapter.transcribeVoice(input)
                      : Effect.fail(
                          new Error(
                            `Voice transcription is unavailable for provider '${input.provider}'.`,
                          ),
                        ),
                  ),
                ),
            ),
            "Voice transcription failed",
          ),
        [WS_METHODS.serverGenerateThreadRecap]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings;
              const modelSelection =
                input.textGenerationModelSelection ?? settings.textGenerationModelSelection;
              return yield* textGeneration.generateThreadRecap({
                cwd: input.cwd,
                newMaterial: input.newMaterial,
                ...(input.previousRecap ? { previousRecap: input.previousRecap } : {}),
                ...(input.currentState ? { currentState: input.currentState } : {}),
                ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
                model: input.textGenerationModel ?? modelSelection.model,
                modelSelection,
                ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
              });
            }),
            "Failed to generate thread recap",
          ),
        [WS_METHODS.serverGenerateAutomationIntent]: (input) =>
          rpcEffect(
            Effect.gen(function* () {
              const settings = yield* serverSettings.getSettings;
              const modelSelection =
                input.textGenerationModelSelection ?? settings.textGenerationModelSelection;
              return yield* textGeneration.generateAutomationIntent({
                cwd: input.cwd,
                message: input.message,
                ...(input.defaultMode ? { defaultMode: input.defaultMode } : {}),
                nowIso: input.nowIso,
                ...(input.codexHomePath ? { codexHomePath: input.codexHomePath } : {}),
                model: input.textGenerationModel ?? modelSelection.model,
                modelSelection,
                ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
              });
            }),
            "Failed to generate automation intent",
          ),
        [WS_METHODS.serverUpsertKeybinding]: (input) =>
          rpcEffect(
            keybindings
              .upsertKeybindingRule(input.rule, input.replacing)
              .pipe(
                Effect.map((keybindingsConfig) => ({ keybindings: keybindingsConfig, issues: [] })),
              ),
            "Failed to update keybinding",
          ),
        [WS_METHODS.subscribeServerLifecycle]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.lifecycle" },
            Stream.concat(
              Stream.fromEffect(
                lifecycleEvents.snapshot.pipe(
                  Effect.map((snapshot) =>
                    Array.from(snapshot.events).toSorted(
                      (left, right) => left.sequence - right.sequence,
                    ),
                  ),
                ),
              ).pipe(Stream.flatMap(Stream.fromIterable)),
              bufferLiveUiStream(lifecycleEvents.stream, {
                label: "server.lifecycle",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }),
            ).pipe(
              Stream.map(
                (event): ServerLifecycleStreamEvent =>
                  event.type === "welcome"
                    ? { type: "welcome", payload: event.payload }
                    : event.type === "ready"
                      ? { type: "ready", payload: event.payload }
                      : { type: "maintenance", payload: event.payload },
              ),
            ),
          ),
        [WS_METHODS.subscribeServerConfig]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.config" },
            Stream.concat(
              Stream.fromEffect(
                loadServerConfig.pipe(
                  Effect.map(
                    (config): ServerConfigStreamEvent => ({
                      type: "snapshot" as const,
                      config,
                    }),
                  ),
                ),
              ),
              Stream.merge(
                bufferLiveUiStream(keybindings.streamChanges, {
                  label: "server.keybindings",
                  onDroppedEvents: failLiveUiStreamForSnapshotResync,
                }).pipe(
                  Stream.map((event) => ({
                    type: "configUpdated" as const,
                    payload: { issues: event.issues, providers: [] },
                  })),
                ),
                Stream.merge(
                  bufferLiveUiStream(providerHealth.streamChanges, {
                    label: "server.provider-statuses",
                    onDroppedEvents: failLiveUiStreamForSnapshotResync,
                  }).pipe(
                    Stream.map((providers) => ({
                      type: "providerStatuses" as const,
                      payload: { providers },
                    })),
                  ),
                  bufferLiveUiStream(serverSettings.streamViews, {
                    label: "server.settings",
                    onDroppedEvents: failLiveUiStreamForSnapshotResync,
                  }).pipe(
                    Stream.map((settings) => ({
                      type: "settingsUpdated" as const,
                      payload: { settings },
                    })),
                  ),
                ),
              ),
            ).pipe(Stream.mapError((cause) => toWsRpcError(cause, "Server config stream failed"))),
          ),
        [WS_METHODS.subscribeServerProviderStatuses]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.provider-statuses" },
            Stream.concat(
              Stream.fromEffect(
                providerHealth.getStatuses.pipe(Effect.map((providers) => ({ providers }))),
              ),
              bufferLiveUiStream(providerHealth.streamChanges, {
                label: "server.provider-statuses",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }).pipe(Stream.map((providers) => ({ providers }))),
            ),
          ),
        [WS_METHODS.subscribeServerSettings]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "server.settings" },
            Stream.concat(
              Stream.fromEffect(
                serverSettings.getSettingsView.pipe(Effect.map((settings) => ({ settings }))),
              ),
              bufferLiveUiStream(serverSettings.streamViews, {
                label: "server.settings",
                onDroppedEvents: failLiveUiStreamForSnapshotResync,
              }).pipe(Stream.map((settings) => ({ settings }))),
            ).pipe(
              Stream.mapError((cause) => toWsRpcError(cause, "Server settings stream failed")),
            ),
          ),

        [WS_METHODS.providerGetComposerCapabilities]: (input) =>
          rpcEffect(
            providerDiscoveryService.getComposerCapabilities(input),
            "Failed to get composer capabilities",
          ),
        [WS_METHODS.providerCompactThread]: (input) =>
          rpcEffect(providerService.compactThread(input), "Failed to compact thread"),
        [WS_METHODS.providerListCommands]: (input) =>
          rpcEffect(providerDiscoveryService.listCommands(input), "Failed to list commands"),
        [WS_METHODS.providerListSkills]: (input) =>
          rpcEffect(providerDiscoveryService.listSkills(input), "Failed to list skills"),
        [WS_METHODS.providerListSkillsCatalog]: (input) =>
          rpcEffect(
            Effect.tryPromise(() =>
              discoverSkillsCatalog({
                cwd: input.cwd ?? null,
                homeDir: config.homeDir,
                veylenBaseDir: config.baseDir,
                includeDuplicateOrigins: true,
              }),
            ).pipe(
              Effect.map((skills) => ({
                skills,
                veylenSkillsDir: veylenSkillsDir(config.baseDir),
              })),
            ),
            "Failed to list the skills catalog",
          ),
        [WS_METHODS.providerListPlugins]: (input) =>
          rpcEffect(providerDiscoveryService.listPlugins(input), "Failed to list plugins"),
        [WS_METHODS.providerReadPlugin]: (input) =>
          rpcEffect(providerDiscoveryService.readPlugin(input), "Failed to read plugin"),
        [WS_METHODS.providerListModels]: (input) =>
          rpcEffect(providerDiscoveryService.listModels(input), "Failed to list models"),
        [WS_METHODS.providerListAgents]: (input) =>
          rpcEffect(providerDiscoveryService.listAgents(input), "Failed to list agents"),
        [WS_METHODS.automationList]: (input) =>
          rpcEffect(automationService.list(input), "Failed to list automations"),
        [WS_METHODS.automationGetMemory]: ({ automationId }) =>
          rpcEffect(automationService.getMemory(automationId), "Failed to load automation memory"),
        [WS_METHODS.automationCreate]: (input) =>
          rpcEffect(automationService.create(input), "Failed to create automation"),
        [WS_METHODS.automationUpdate]: (input) =>
          rpcEffect(automationService.update(input), "Failed to update automation"),
        [WS_METHODS.automationDelete]: (input) =>
          rpcEffect(automationService.delete(input), "Failed to delete automation"),
        [WS_METHODS.automationRunNow]: (input) =>
          rpcEffect(automationService.runNow(input), "Failed to run automation"),
        [WS_METHODS.automationCancelRun]: (input) =>
          rpcEffect(automationService.cancelRun(input), "Failed to cancel automation run"),
        [WS_METHODS.automationMarkRunRead]: (input) =>
          rpcEffect(automationService.markRunRead(input), "Failed to update automation run"),
        [WS_METHODS.automationArchiveRun]: (input) =>
          rpcEffect(automationService.archiveRun(input), "Failed to update automation run"),
        [WS_METHODS.automationResolveProposal]: (input) =>
          rpcEffect(
            automationService.resolveProposal(input),
            "Failed to resolve automation proposal",
          ),
        [WS_METHODS.subscribeAutomationEvents]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "automation.events" },
            Stream.merge(
              Stream.fromEffect(
                automationService.list({}).pipe(
                  Effect.map(({ definitions, runs, memories }) => ({
                    type: "snapshot" as const,
                    definitions,
                    runs,
                    memories,
                  })),
                ),
              ),
              automationService.streamEvents,
            ).pipe(
              Stream.mapError((cause) => toWsRpcError(cause, "Automation event stream failed")),
            ),
          ),

        ...makeWsDeviceHandlers(deviceService),
        [DEVICE_WS_METHODS.subscribeEvents]: (_, { clientId }) =>
          streamAdmission.guard(
            clientId,
            { key: "device.events" },
            // Device pushes are lossy by design: thread state is a versioned
            // full snapshot, so a client that falls behind converges on the
            // next one rather than needing every intermediate state.
            //
            // `Stream.never`, not `Stream.empty`, where no device engine can
            // run. This is an infinite subscription, and the client treats one
            // that completes as a zombie socket: it forces a full reconnect to
            // recover it, and an empty stream completes instantly, so the pair
            // loops. That churn restarts every other subscription with it,
            // which is how unrelated RPCs began missing their replies on Linux
            // CI. Staying open and silent is what "no events will ever arrive"
            // actually means.
            //
            // Gated on `supported`, not just on the service existing: the layer
            // is provided on every platform so callers need not branch on null,
            // and off darwin it resolves to a service whose backend reports
            // unsupported-platform. `makeWsDeviceHandlers` already branches the
            // same way.
            deviceService?.supported !== true
              ? Stream.never
              : bufferLiveUiStream(
                  Stream.callback<DeviceEvent>((queue) =>
                    Effect.gen(function* () {
                      const unsubscribe = deviceService.manager.onEvent((event) => {
                        Effect.runFork(Queue.offer(queue, event).pipe(Effect.asVoid));
                      });
                      yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));
                    }),
                  ),
                  { label: "device.events" },
                ),
          ),
      });
    }),
  );

export const makeWsRpcLayer = () =>
  Layer.merge(makeWsRpcHandlersLayer(), wsRequestAdmissionMiddlewareLayer);

const makeRpcWebSocketHttpEffect = RpcServer.toHttpEffectWebsocket(AdmittedWsFeatureRpcGroup, {
  spanPrefix: "ws.rpc",
  spanAttributes: {
    "rpc.transport": "websocket",
    "rpc.system": "effect-rpc",
  },
  // JSON keeps the wire format symmetric with any web build. A serialization
  // mismatch on this single multiplexed socket is a hard connect failure, and the
  // desktop/dev setup routinely runs server and web on independently-built copies.
}).pipe(Effect.provide(makeWsRpcLayer().pipe(Layer.provideMerge(RpcSerialization.layerJson))));

const makeBootstrapWebSocketHttpEffect = RpcServer.toHttpEffectWebsocket(WsBootstrapRpcGroup, {
  spanPrefix: "ws.bootstrap",
  spanAttributes: {
    "rpc.transport": "websocket",
    "rpc.system": "effect-rpc",
  },
}).pipe(
  Effect.provide(
    WsBootstrapRpcGroup.toLayer(
      Effect.succeed(
        WsBootstrapRpcGroup.of({
          [WS_BOOTSTRAP_METHOD]: negotiateWsCompatibility,
        }),
      ),
    ).pipe(Layer.provideMerge(RpcSerialization.layerJson)),
  ),
);

function trustedWebSocketRequestUrl(
  request: HttpServerRequest.HttpServerRequest,
  config: ServerConfigShape,
): URL | null {
  const url = HttpServerRequest.toURL(request);
  return url &&
    !shouldRejectUntrustedRequestOrigin({
      rawOrigin: request.headers.origin,
      requestOrigin: url.origin,
      config,
    })
    ? url
    : null;
}

export function authenticateRpcWebSocketUpgrade(input: {
  readonly config: Pick<ServerConfigShape, "authToken" | "host" | "publicUrl">;
  readonly legacyToken: string | null;
  readonly request: AuthRequest;
  readonly serverAuth: Pick<ServerAuthShape, "authenticateWebSocketUpgrade">;
}): Effect.Effect<AuthenticatedSession | null, AuthError> {
  if (
    !requiresWebSocketAuthentication(input.config) ||
    (isLoopbackHost(input.config.host) &&
      !input.config.publicUrl &&
      input.legacyToken === input.config.authToken)
  ) {
    return Effect.succeed(null);
  }
  return input.serverAuth.authenticateWebSocketUpgrade(input.request);
}

/**
 * Apply the feature socket's authentication policy to the separate device
 * frame socket. The desktop bridge still supplies the loopback-only legacy
 * `?token=` credential, so this path must share the same compatibility rule as
 * the RPC socket rather than calling ServerAuth directly.
 */
export function authorizeDeviceFrameWebSocketUpgrade(input: {
  readonly config: Pick<ServerConfigShape, "authToken" | "host" | "publicUrl">;
  readonly legacyToken: string | null;
  readonly request: AuthRequest;
  readonly serverAuth: Pick<ServerAuthShape, "authenticateWebSocketUpgrade">;
}): Effect.Effect<boolean> {
  return authenticateRpcWebSocketUpgrade(input).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );
}

export function makeWebsocketRpcRouteLayer<R>(
  rpcWebSocketHttpEffectSource: Effect.Effect<
    Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      never,
      HttpServerRequest.HttpServerRequest | Scope.Scope
    >,
    never,
    R
  >,
) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const rpcWebSocketHttpEffect = yield* rpcWebSocketHttpEffectSource;
      const connectionSessions = yield* WsConnectionSessions;
      const router = yield* HttpRouter.HttpRouter;
      // RPC handlers run on fibers forked from the layer-build scope, not from
      // this per-connection fiber, so the authenticated session cannot be
      // provided as a plain service around rpcWebSocketHttpEffect. Instead the
      // session is registered for the connection's lifetime and its key is
      // injected as a synthetic upgrade header; the admission middleware
      // resolves it back into handler-scoped services on every request.
      const runWithConnectionSession = (
        request: HttpServerRequest.HttpServerRequest,
        session: WsConnectionSession,
      ) =>
        Effect.gen(function* () {
          const sessionKey = yield* connectionSessions.register(session);
          return yield* rpcWebSocketHttpEffect.pipe(
            Effect.provideService(
              HttpServerRequest.HttpServerRequest,
              request.modify({
                headers: Headers.set(request.headers, WS_CONNECTION_SESSION_HEADER, sessionKey),
              }),
            ),
          );
        });
      yield* router.add(
        "GET",
        WS_FEATURE_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const serverAuth = yield* ServerAuth;
          const sessions = yield* SessionCredentialService;
          const url = trustedWebSocketRequestUrl(request, config);
          if (!url) {
            return HttpServerResponse.text("Forbidden", { status: 403 });
          }
          const compatibilityError = validateWsFeatureCompatibility(url.searchParams);
          if (compatibilityError) {
            return HttpServerResponse.jsonUnsafe(compatibilityError, {
              status: 426,
              headers: { "Cache-Control": "no-store" },
            });
          }
          const legacyToken = url.searchParams.get("token");
          const authenticatedSession = yield* authenticateRpcWebSocketUpgrade({
            config,
            legacyToken,
            request: makeEffectAuthRequest(request),
            serverAuth,
          });

          if (!authenticatedSession) {
            return yield* runWithConnectionSession(request, {
              role: "owner",
              attachmentPrincipal: LOCAL_LOOPBACK_ATTACHMENT_PRINCIPAL,
            });
          }

          return yield* sessions.runAuthenticatedConnection(
            authenticatedSession.sessionId,
            runWithConnectionSession(request, {
              role: authenticatedSession.role,
              attachmentPrincipal: attachmentPrincipalForSession(authenticatedSession.sessionId),
            }),
          );
        }).pipe(
          Effect.catchTags({
            AuthError: (error) => Effect.succeed(authErrorResponse(error)),
            SessionCapacityError: (error) =>
              Effect.succeed(
                HttpServerResponse.text(error.message, {
                  status: 429,
                  headers: {
                    "Cache-Control": "no-store",
                    "Retry-After": String(error.retryAfterSeconds),
                  },
                }),
              ),
            SessionCredentialError: (error) =>
              Effect.succeed(HttpServerResponse.text(error.message, { status: 401 })),
          }),
        ),
      );
    }),
  );
}

// Negotiation over plain HTTP: a connect costs exactly one WebSocket upgrade
// instead of the legacy bootstrap-socket round trip. Advertised to clients via
// the "transport.http-negotiate" capability; the WS_BOOTSTRAP_PATH socket stays
// available for older clients during rollout.
function makeWsNegotiateHttpRouteLayer() {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const router = yield* HttpRouter.HttpRouter;
      yield* router.add(
        "GET",
        WS_NEGOTIATE_HTTP_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const url = trustedWebSocketRequestUrl(request, config);
          if (!url) {
            // Same no-store discipline as the negotiated responses: an
            // intermediary must never cache a refusal keyed on our behalf.
            return HttpServerResponse.text("Forbidden", {
              status: 403,
              headers: { "Cache-Control": "no-store", Vary: "Origin" },
            });
          }
          // The desktop app fetches cross-origin (veylen://app); reflect only
          // origins the WS upgrade itself would trust.
          const origin = normalizeCorsOrigin(request.headers.origin);
          const corsHeaders =
            origin && isTrustedAppOrigin({ origin, requestOrigin: url.origin, config })
              ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
              : {};
          const headers = { "Cache-Control": "no-store", ...corsHeaders };
          const input = parseWsNegotiateSearchParams(url.searchParams);
          if (input instanceof WsCompatibilityError) {
            return HttpServerResponse.jsonUnsafe(input, { status: 426, headers });
          }
          return yield* negotiateWsCompatibility(input).pipe(
            Effect.map((result) => HttpServerResponse.jsonUnsafe(result, { status: 200, headers })),
            Effect.catch((error) =>
              Effect.succeed(HttpServerResponse.jsonUnsafe(error, { status: 426, headers })),
            ),
          );
        }),
      );
    }),
  );
}

function makeWebsocketBootstrapRouteLayer<R>(
  bootstrapWebSocketHttpEffectSource: Effect.Effect<
    Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      never,
      HttpServerRequest.HttpServerRequest | Scope.Scope
    >,
    never,
    R
  >,
) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      const bootstrapWebSocketHttpEffect = yield* bootstrapWebSocketHttpEffectSource;
      const router = yield* HttpRouter.HttpRouter;
      yield* router.add(
        "GET",
        WS_BOOTSTRAP_PATH,
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const config = yield* ServerConfig;
          const url = trustedWebSocketRequestUrl(request, config);
          if (!url) {
            return HttpServerResponse.text("Forbidden", { status: 403 });
          }
          return yield* bootstrapWebSocketHttpEffect;
        }),
      );
    }),
  );
}

// Both negotiation surfaces: the single-handshake HTTP endpoint and the legacy
// bootstrap socket kept for older clients during rollout. Exported separately
// so route-level tests can mount them beside a custom feature RPC group.
export const makeWebsocketNegotiationRouteLayer = () =>
  Layer.merge(
    makeWsNegotiateHttpRouteLayer(),
    makeWebsocketBootstrapRouteLayer(makeBootstrapWebSocketHttpEffect),
  );

/**
 * Video rides a second WebSocket (see `deviceFrameRoute`), so it is admitted by
 * the same rules as the RPC upgrade: trusted origin, then whatever
 * authentication the config requires.
 */
const deviceFrameRouteLayer = makeDeviceFrameRouteLayer({
  authorizeUpgrade: (request) =>
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const serverAuth = yield* ServerAuth;
      const url = trustedWebSocketRequestUrl(request, config);
      if (url === null) return false;
      return yield* authorizeDeviceFrameWebSocketUpgrade({
        config,
        legacyToken: url.searchParams.get("token"),
        request: makeEffectAuthRequest(request),
        serverAuth,
      });
    }),
});

export const websocketRpcRouteLayer = Layer.mergeAll(
  deviceFrameRouteLayer,
  makeWebsocketNegotiationRouteLayer(),
  // The registry must be provided here so the upgrade route and the RPC
  // middleware (built from the same source effect) share one instance.
  makeWebsocketRpcRouteLayer(makeRpcWebSocketHttpEffect).pipe(
    Layer.provide(WsConnectionSessionsLive),
  ),
);
