export type KanbanSurface = "projects" | "supervised";

export interface KanbanRouteSearch {
  surface?: KanbanSurface;
}

export function validateKanbanRouteSearch(raw: Record<string, unknown>): KanbanRouteSearch {
  return raw.surface === "supervised" ? { surface: "supervised" } : {};
}

export function isSupervisedKanbanSearch(search: unknown): boolean {
  return (
    typeof search === "object" &&
    search !== null &&
    "surface" in search &&
    search.surface === "supervised"
  );
}
