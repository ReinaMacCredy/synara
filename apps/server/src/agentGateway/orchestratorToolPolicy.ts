import type {
  OrchestratorCapability,
  OrchestratorRole,
  OrchestratorToolName,
  ThreadId,
} from "@synara/contracts";
import type { ProjectionOrchestratorCore } from "../persistence/Services/ProjectionOrchestrator.ts";
import { capabilitiesForRole } from "../orchestration/orchestrator/invariants.ts";

export interface OrchestratorCallerAuthority {
  readonly rootThreadId: ThreadId;
  readonly callerThreadId: ThreadId;
  readonly role: OrchestratorRole;
  readonly capabilities: ReadonlySet<OrchestratorCapability>;
  readonly core: ProjectionOrchestratorCore;
}

const TOOL_CAPABILITY = {
  synara_task_process_create: "task.manage",
  synara_task_process_get: "state.read",
  synara_task_create: "task.manage",
  synara_task_update: "task.manage",
  synara_task_set_dependencies: "task.manage",
  synara_task_transition: "task.manage",
  synara_orchestrator_get_state: "state.read",
  synara_orchestrator_assign_task: "child.assign",
  synara_orchestrator_send_message: "message.send",
  synara_orchestrator_request_link: "link.request",
  synara_orchestrator_set_link: "link.manage",
  synara_orchestrator_publish_artifact: "artifact.publish",
  synara_orchestrator_update_run: "run.manage",
  synara_orchestrator_read_child: "subtree.read",
  synara_orchestrator_report_status: "assignment.report",
  synara_orchestrator_request_change: "assignment.report",
  synara_orchestrator_wait: "state.read",
  synara_orchestrator_retire_child: "child.retire",
} as const satisfies Readonly<Record<OrchestratorToolName, OrchestratorCapability>>;

export const resolveOrchestratorCallerAuthority = (input: {
  readonly core: ProjectionOrchestratorCore;
  readonly callerThreadId: ThreadId;
}): OrchestratorCallerAuthority | null => {
  const { core, callerThreadId } = input;
  if (core.root.root.state !== "active") return null;
  if (core.root.root.rootThreadId === callerThreadId) {
    return {
      rootThreadId: core.root.root.rootThreadId,
      callerThreadId,
      role: "root",
      capabilities: capabilitiesForRole("root"),
      core,
    };
  }
  const edge = core.ownershipEdges
    .filter(
      (candidate) => candidate.childThreadId === callerThreadId && candidate.retiredAt === null,
    )
    .toSorted((left, right) => right.contractVersion - left.contractVersion)[0];
  if (!edge) return null;
  const ceiling = capabilitiesForRole(edge.role);
  return {
    rootThreadId: edge.rootThreadId,
    callerThreadId,
    role: edge.role,
    capabilities: new Set(edge.capabilities.filter((capability) => ceiling.has(capability))),
    core,
  };
};

export const isOrchestratorToolVisible = (
  authority: OrchestratorCallerAuthority,
  toolName: OrchestratorToolName,
): boolean => authority.capabilities.has(TOOL_CAPABILITY[toolName]);

export const visibleOrchestratorToolNames = (
  authority: OrchestratorCallerAuthority,
): ReadonlyArray<OrchestratorToolName> =>
  (Object.keys(TOOL_CAPABILITY) as ReadonlyArray<OrchestratorToolName>).filter((toolName) =>
    isOrchestratorToolVisible(authority, toolName),
  );

const descendantsOf = (
  core: ProjectionOrchestratorCore,
  parentThreadId: ThreadId,
): ReadonlySet<ThreadId> => {
  const descendants = new Set<ThreadId>();
  const queue = [parentThreadId];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const edge of core.ownershipEdges) {
      if (
        edge.retiredAt !== null ||
        edge.parentThreadId !== parent ||
        descendants.has(edge.childThreadId)
      ) {
        continue;
      }
      descendants.add(edge.childThreadId);
      queue.push(edge.childThreadId);
    }
  }
  return descendants;
};

export const readableThreadsForCaller = (
  authority: OrchestratorCallerAuthority,
): ReadonlySet<ThreadId> => {
  if (authority.role === "root") {
    return new Set([
      authority.rootThreadId,
      ...authority.core.ownershipEdges
        .filter((edge) => edge.retiredAt === null)
        .map((edge) => edge.childThreadId),
    ]);
  }
  return new Set([
    authority.callerThreadId,
    ...(authority.capabilities.has("subtree.read")
      ? descendantsOf(authority.core, authority.callerThreadId)
      : []),
  ]);
};

export const canReadOrchestratorThread = (
  authority: OrchestratorCallerAuthority,
  targetThreadId: ThreadId,
): boolean => readableThreadsForCaller(authority).has(targetThreadId);

export const filterOrchestratorCoreForCaller = (
  authority: OrchestratorCallerAuthority,
): ProjectionOrchestratorCore => {
  if (authority.role === "root") return authority.core;
  const readable = readableThreadsForCaller(authority);
  const relevantThreads = new Set<ThreadId>([authority.callerThreadId, ...readable]);
  return {
    ...authority.core,
    ownershipEdges: authority.core.ownershipEdges.filter(
      (edge) =>
        edge.retiredAt === null &&
        (relevantThreads.has(edge.parentThreadId) || relevantThreads.has(edge.childThreadId)),
    ),
    communicationLinks: authority.core.communicationLinks.filter(
      (link) =>
        relevantThreads.has(link.sourceThreadId) || relevantThreads.has(link.targetThreadId),
    ),
    assignments: authority.core.assignments.filter(
      (assignment) =>
        relevantThreads.has(assignment.ownerThreadId) ||
        relevantThreads.has(assignment.assigneeThreadId),
    ),
    runs: authority.core.runs.filter((run) =>
      run.participants.some((participant) => relevantThreads.has(participant.threadId)),
    ),
    providerCapabilities: [],
    capacity: null,
  };
};
