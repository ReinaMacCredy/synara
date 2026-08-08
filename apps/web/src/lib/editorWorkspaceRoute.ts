export function isEditorWorkspaceLocation(input: {
  readonly pathname: string;
  readonly view?: unknown;
}): boolean {
  if (input.view === "editor") return true;
  if (input.view === "chat") return false;
  return /^\/supervised\/[^/]+\/?$/.test(input.pathname);
}
