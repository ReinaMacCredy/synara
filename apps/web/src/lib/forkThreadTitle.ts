// FILE: forkThreadTitle.ts
// Purpose: ChatGPT-style fork naming — "Hi" → "Hi (2)" → "Hi (3)".
// Layer: Web domain helper
// Exports: buildForkedThreadTitle, parseForkThreadTitleBase

/** Strip a trailing " (n)" counter so "Hi (2)" and "Hi" share the same base. */
export function parseForkThreadTitleBase(title: string): {
  base: string;
  number: number;
} {
  const trimmed = title.trim();
  const match = trimmed.match(/^(.*?)(?:\s+\((\d+)\))?$/);
  const base = (match?.[1] ?? trimmed).trim() || "Chat";
  const raw = match?.[2];
  const number = raw !== undefined ? Number(raw) : 1;
  return {
    base,
    number: Number.isFinite(number) && number >= 1 ? number : 1,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Next title in the fork series for this base among existing project titles.
 * Bare "Hi" counts as 1, so the first fork is "Hi (2)".
 */
export function buildForkedThreadTitle(
  sourceTitle: string,
  existingTitles: ReadonlyArray<string> = [],
): string {
  const { base } = parseForkThreadTitleBase(sourceTitle);
  const pattern = new RegExp(`^${escapeRegExp(base)}(?:\\s+\\((\\d+)\\))?$`, "i");
  let max = 1;
  for (const title of existingTitles) {
    const match = title.trim().match(pattern);
    if (!match) continue;
    const n = match[1] !== undefined ? Number(match[1]) : 1;
    if (Number.isFinite(n) && n > max) max = n;
  }
  // Always advance at least past the source's own number.
  const sourceNumber = parseForkThreadTitleBase(sourceTitle).number;
  if (sourceNumber > max) max = sourceNumber;
  return `${base} (${max + 1})`;
}
