export const EDITOR_WORKSPACE_EXIT_MS = 160;

export function editorWorkspaceMotionClassName(exiting: boolean): string {
  return exiting ? "editor-workspace-exit" : "editor-workspace-enter";
}
