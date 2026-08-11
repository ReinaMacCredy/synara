import { describe, expect, it } from "vitest";

import { isSupervisedKanbanSearch, validateKanbanRouteSearch } from "./kanbanRouteSearch";

describe("kanbanRouteSearch", () => {
  it("preserves only the supervised surface", () => {
    expect(validateKanbanRouteSearch({ surface: "supervised" })).toEqual({
      surface: "supervised",
    });
    expect(validateKanbanRouteSearch({ surface: "projects" })).toEqual({});
    expect(validateKanbanRouteSearch({ surface: "unknown" })).toEqual({});
  });

  it("recognizes supervised Kanban locations", () => {
    expect(isSupervisedKanbanSearch({ surface: "supervised" })).toBe(true);
    expect(isSupervisedKanbanSearch({})).toBe(false);
    expect(isSupervisedKanbanSearch(null)).toBe(false);
  });
});
