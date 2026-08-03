import type { HandoffCapsuleItemV1 } from "@synara/contracts";
import { Effect } from "effect";

import type { OrchestratorToolRuntimeShape } from "../orchestration/Services/OrchestratorToolRuntime.ts";
import type { OrchestratorToolDefinition } from "../orchestration/orchestrator/toolRuntime.ts";

const definition = (
  name: string,
  displayName: string,
  description: string,
  inputSchema: Record<string, unknown>,
): OrchestratorToolDefinition =>
  ({
    name,
    displayName,
    description,
    inputSchema,
    readOnly: true,
    providerSupport: { codex: "native", claude: "unsupported" },
  }) as OrchestratorToolDefinition;

export const HANDOFF_NATIVE_TOOL_CATALOG = [
  definition(
    "list_handoff_sources",
    "List handoff sources",
    "List bounded evidence references in the sealed source snapshot.",
    { type: "object", properties: {}, additionalProperties: false },
  ),
  definition(
    "read_handoff_source",
    "Read handoff source",
    "Read one exact source reference from the sealed snapshot.",
    {
      type: "object",
      properties: { ref: { type: "string" } },
      required: ["ref"],
      additionalProperties: false,
    },
  ),
  definition(
    "search_handoff_source",
    "Search handoff source",
    "Search the sealed source snapshot without widening its watermark.",
    {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  ),
] as const;

export function makeHandoffToolRuntime(
  items: ReadonlyArray<HandoffCapsuleItemV1>,
): OrchestratorToolRuntimeShape {
  const byRef = new Map(items.map((item) => [item.ref, item]));
  return {
    catalog: HANDOFF_NATIVE_TOOL_CATALOG,
    list: () => Effect.succeed(HANDOFF_NATIVE_TOOL_CATALOG),
    execute: ({ name, arguments: args }) => {
      if (name === "list_handoff_sources") {
        return Effect.succeed({
          ok: true as const,
          value: items.map(({ ref, role, createdAt }) => ({ ref, role, createdAt })),
        });
      }
      if (name === "read_handoff_source") {
        const ref = typeof args.ref === "string" ? args.ref : "";
        const item = byRef.get(ref);
        return Effect.succeed(
          item
            ? { ok: true as const, value: item }
            : {
                ok: false as const,
                error: {
                  code: "handoff_source_not_found",
                  message: `Source '${ref}' is unavailable.`,
                },
              },
        );
      }
      if (name === "search_handoff_source") {
        const query = typeof args.query === "string" ? args.query.trim().toLocaleLowerCase() : "";
        const limit = typeof args.limit === "number" ? Math.min(20, Math.max(1, args.limit)) : 8;
        if (!query) {
          return Effect.succeed({
            ok: false as const,
            error: { code: "handoff_query_required", message: "Search query is required." },
          });
        }
        return Effect.succeed({
          ok: true as const,
          value: items
            .filter((item) => item.text.toLocaleLowerCase().includes(query))
            .slice(0, limit),
        });
      }
      return Effect.succeed({
        ok: false as const,
        error: { code: "handoff_tool_unknown", message: `Unknown handoff tool '${name}'.` },
      });
    },
  };
}
