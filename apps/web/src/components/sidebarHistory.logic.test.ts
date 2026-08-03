import { describe, expect, it } from "vitest";

import { groupSidebarHistory } from "./sidebarHistory.logic";

const item = (
  id: string,
  createdAt: string,
  overrides: Partial<{
    isPinned: boolean;
    pinnedAt: string | null;
    lastMeaningfulActivityAt: string | null;
    updatedAt: string | null;
  }> = {},
) => ({ id, createdAt, ...overrides });

describe("groupSidebarHistory", () => {
  it("shows pinned rows once and buckets the rest by local calendar day", () => {
    const sections = groupSidebarHistory({
      now: new Date("2026-08-02T12:00:00"),
      items: [
        item("pinned", "2026-07-20T10:00:00", {
          isPinned: true,
          pinnedAt: "2026-08-02T09:00:00",
        }),
        item("today", "2026-08-02T08:00:00"),
        item("yesterday", "2026-08-01T08:00:00"),
        item("weekday", "2026-07-30T08:00:00"),
        item("older", "2026-07-10T08:00:00"),
        item("prior-year", "2025-12-10T08:00:00"),
      ],
    });

    expect(sections.map((section) => section.label)).toEqual([
      "Pinned",
      "Today",
      "Yesterday",
      new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(
        new Date("2026-07-30T08:00:00"),
      ),
      new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(
        new Date("2026-07-10T08:00:00"),
      ),
      new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(new Date("2025-12-10T08:00:00")),
    ]);
    expect(sections.flatMap((section) => section.items.map((entry) => entry.id))).toEqual([
      "pinned",
      "today",
      "yesterday",
      "weekday",
      "older",
      "prior-year",
    ]);
  });

  it("promotes meaningful subtree activity without using passive updatedAt churn", () => {
    const sections = groupSidebarHistory({
      now: new Date("2026-08-02T12:00:00"),
      items: [
        item("root-a", "2026-07-20T08:00:00", {
          updatedAt: "2026-08-02T11:59:00",
          lastMeaningfulActivityAt: "2026-08-01T10:00:00",
        }),
        item("root-b", "2026-07-20T08:00:00", {
          lastMeaningfulActivityAt: "2026-08-02T10:00:00",
        }),
      ],
    });

    expect(
      sections.map((section) => [section.label, section.items.map((entry) => entry.id)]),
    ).toEqual([
      ["Today", ["root-b"]],
      ["Yesterday", ["root-a"]],
    ]);
  });
});
