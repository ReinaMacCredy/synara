import type { HandoffCapsuleItemV1 } from "@synara/contracts";

const sourceReferenceKind = (item: HandoffCapsuleItemV1): "message" | "note" | "activity" => {
  if (item.role === "note") return "note";
  if (item.role === "activity") return "activity";
  return "message";
};

const makeSourceReferenceResolver = (sourceItems: ReadonlyArray<HandoffCapsuleItemV1>) => {
  const aliases = new Map<string, string>();
  const ambiguous = new Set<string>();
  const register = (alias: string, canonical: string) => {
    const existing = aliases.get(alias);
    if (existing !== undefined && existing !== canonical) {
      aliases.delete(alias);
      ambiguous.add(alias);
      return;
    }
    if (!ambiguous.has(alias)) aliases.set(alias, canonical);
  };

  for (const item of sourceItems) {
    register(item.ref, item.ref);
    if (item.role !== "user" && item.role !== "assistant") continue;
    const prefix = "message:";
    if (!item.ref.startsWith(prefix)) continue;
    const suffix = item.ref.slice(prefix.length);
    const rolePrefix = `${item.role}:`;
    if (suffix.startsWith(rolePrefix)) {
      register(`${prefix}${suffix.slice(rolePrefix.length)}`, item.ref);
    } else {
      register(`${prefix}${item.role}:${suffix}`, item.ref);
    }
  }

  return (ref: string) => aliases.get(ref) ?? ref;
};

const projectCitationReferences = (
  value: unknown,
  resolveRef: (ref: string) => string,
  key?: string,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) =>
      key === "citations" && typeof item === "string"
        ? resolveRef(item)
        : projectCitationReferences(item, resolveRef, key),
    );
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([entryKey, entryValue]) => {
      if (key === "citations" && entryKey === "ref" && typeof entryValue === "string") {
        return [entryKey, resolveRef(entryValue)];
      }
      return [entryKey, projectCitationReferences(entryValue, resolveRef, entryKey)];
    }),
  );
};

export function projectHandoffPacketSourceReferences(
  raw: unknown,
  sourceItems: ReadonlyArray<HandoffCapsuleItemV1>,
): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;

  const resolveRef = makeSourceReferenceResolver(sourceItems);
  const body = projectCitationReferences(raw, resolveRef) as Record<string, unknown>;
  if (!Array.isArray(body.citations)) return body;

  const sourceKinds = new Map(
    sourceItems.map((item) => [item.ref, sourceReferenceKind(item)] as const),
  );

  return {
    ...body,
    citations: body.citations.map((citation) => {
      if (typeof citation !== "object" || citation === null || Array.isArray(citation)) {
        return citation;
      }
      const reference = citation as Record<string, unknown>;
      const ref = typeof reference.ref === "string" ? reference.ref : "";
      return {
        ...reference,
        kind: sourceKinds.get(ref) ?? "message",
      };
    }),
  };
}
