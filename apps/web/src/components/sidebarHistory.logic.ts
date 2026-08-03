export type SidebarHistorySectionKey =
  | "pinned"
  | "today"
  | "yesterday"
  | `weekday:${string}`
  | `date:${string}`;

export interface SidebarHistoryItem {
  readonly id: string;
  readonly isPinned?: boolean;
  readonly pinnedAt?: string | null;
  readonly pinnedOrder?: number | null;
  readonly lastMeaningfulActivityAt?: string | null;
  readonly updatedAt?: string | null;
  readonly createdAt: string;
}

export interface SidebarHistorySection<T> {
  readonly key: SidebarHistorySectionKey;
  readonly label: string;
  readonly items: readonly T[];
}

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sidebarMeaningfulActivityTimestamp(item: SidebarHistoryItem): number {
  return (
    validTimestamp(item.lastMeaningfulActivityAt) ??
    validTimestamp(item.updatedAt) ??
    validTimestamp(item.createdAt) ??
    0
  );
}

function startOfLocalDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

function historySectionForTimestamp(
  timestamp: number,
  now: Date,
): Pick<SidebarHistorySection<never>, "key" | "label"> {
  const date = new Date(timestamp);
  const dayDifference = Math.max(
    0,
    Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000),
  );
  if (dayDifference === 0) return { key: "today", label: "Today" };
  if (dayDifference === 1) return { key: "yesterday", label: "Yesterday" };
  if (dayDifference <= 6) {
    const label = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
    return { key: `weekday:${label}`, label };
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  const label = new Intl.DateTimeFormat(undefined, {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
  return { key: `date:${label}`, label };
}

export function groupSidebarHistory<T extends SidebarHistoryItem>(input: {
  readonly items: readonly T[];
  readonly now?: Date;
}): SidebarHistorySection<T>[] {
  const now = input.now ?? new Date();
  const pinned = input.items
    .filter((item) => item.isPinned === true)
    .toSorted((left, right) => {
      const leftPinnedAt = validTimestamp(left.pinnedAt);
      const rightPinnedAt = validTimestamp(right.pinnedAt);
      if (leftPinnedAt !== null || rightPinnedAt !== null) {
        const byPinnedAt = (rightPinnedAt ?? 0) - (leftPinnedAt ?? 0);
        if (byPinnedAt !== 0) return byPinnedAt;
      }
      const byPersistedOrder =
        (left.pinnedOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.pinnedOrder ?? Number.MAX_SAFE_INTEGER);
      return byPersistedOrder || left.id.localeCompare(right.id);
    });
  const sections: SidebarHistorySection<T>[] =
    pinned.length > 0 ? [{ key: "pinned", label: "Pinned", items: pinned }] : [];
  const sectionIndexByKey = new Map<SidebarHistorySectionKey, number>();

  for (const item of input.items
    .filter((candidate) => candidate.isPinned !== true)
    .toSorted(
      (left, right) =>
        sidebarMeaningfulActivityTimestamp(right) - sidebarMeaningfulActivityTimestamp(left) ||
        left.id.localeCompare(right.id),
    )) {
    const section = historySectionForTimestamp(sidebarMeaningfulActivityTimestamp(item), now);
    const existingIndex = sectionIndexByKey.get(section.key);
    if (existingIndex === undefined) {
      sectionIndexByKey.set(section.key, sections.length);
      sections.push({ ...section, items: [item] });
      continue;
    }
    const existing = sections[existingIndex]!;
    sections[existingIndex] = { ...existing, items: [...existing.items, item] };
  }

  return sections;
}
