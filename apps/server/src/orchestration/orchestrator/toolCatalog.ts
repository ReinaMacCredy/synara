import type { OrchestratorToolName } from "@synara/contracts";

export const ORCHESTRATOR_TOOL_DISPLAY_NAMES: Readonly<Record<OrchestratorToolName, string>> = {
  list_provider_capabilities: "List provider capabilities",
  create_task_process: "Create task process",
  read_task_process: "Read task process",
  create_task: "Create task",
  update_task: "Update task",
  set_task_dependencies: "Set task dependencies",
  transition_task: "Transition task",
  read_orchestrator_state: "Read orchestrator state",
  assign_task: "Assign task",
  create_child_thread: "Create child thread",
  start_child_conversation: "Start child conversation",
  send_message: "Send message",
  create_communication_link: "Create communication link",
  set_communication_link: "Set communication link",
  publish_artifact: "Publish artifact",
  update_run: "Update run",
  read_thread: "Read thread",
  read_last_message: "Read last message",
  read_transcript: "Read transcript",
  report_status: "Report status",
  resolve_child_result: "Resolve child result",
  request_change: "Request change",
  wait_for_event: "Wait for event",
  retire_child_thread: "Retire child thread",
  list_handoff_sources: "List handoff sources",
  read_handoff_source: "Read handoff source",
  search_handoff_source: "Search handoff source",
};

export function orchestratorToolDisplayName(name: string): string | null {
  return Object.hasOwn(ORCHESTRATOR_TOOL_DISPLAY_NAMES, name)
    ? ORCHESTRATOR_TOOL_DISPLAY_NAMES[name as OrchestratorToolName]
    : null;
}
