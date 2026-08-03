import type {
  OrchestratorCapability,
  OrchestratorRole,
  OrchestratorToolName,
  ThreadId,
} from "@synara/contracts";
import type { ProjectionOrchestratorCore } from "../../persistence/Services/ProjectionOrchestrator.ts";
import { capabilitiesForRole } from "./invariants.ts";

export interface OrchestratorCallerAuthority {
  readonly rootThreadId: ThreadId;
  readonly callerThreadId: ThreadId;
  readonly role: OrchestratorRole;
  readonly capabilities: ReadonlySet<OrchestratorCapability>;
  readonly core: ProjectionOrchestratorCore;
}

const TOOL_CAPABILITY = {
  list_provider_capabilities: "state.read",
  create_task_process: "task.manage",
  read_task_process: "state.read",
  create_task: "task.manage",
  update_task: "task.manage",
  set_task_dependencies: "task.manage",
  transition_task: "task.manage",
  read_orchestrator_state: "state.read",
  assign_task: "child.assign",
  create_child_thread: "child.assign",
  start_child_conversation: "child.assign",
  send_message: "message.send",
  create_communication_link: "link.request",
  set_communication_link: "link.manage",
  publish_artifact: "artifact.publish",
  update_run: "run.manage",
  read_thread: "state.read",
  read_last_message: "state.read",
  read_transcript: "state.read",
  report_status: "assignment.report",
  resolve_child_result: "assignment.accept",
  request_change: "assignment.report",
  wait_for_event: "state.read",
  retire_child_thread: "child.retire",
} as const satisfies Readonly<Partial<Record<OrchestratorToolName, OrchestratorCapability>>>;

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
): boolean => {
  const capability = TOOL_CAPABILITY[toolName as keyof typeof TOOL_CAPABILITY];
  return capability !== undefined && authority.capabilities.has(capability);
};

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
    childResults: (authority.core.childResults ?? []).filter((result) =>
      relevantThreads.has(result.childThreadId),
    ),
    runs: authority.core.runs.filter((run) =>
      run.participants.some((participant) => relevantThreads.has(participant.threadId)),
    ),
    providerCapabilities: [],
    capacity: null,
  };
};
