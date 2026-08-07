export function isEditorWorkspaceLocation(input: {
  readonly pathname: string;
  readonly view?: unknown;
}): boolean {
  if (input.view === "editor") return true;
  return /^\/supervised\/[^/]+\/?$/.test(input.pathname);
}
