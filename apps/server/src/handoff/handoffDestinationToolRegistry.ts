import type {
  AcceptedCrossModeHandoffV1,
  HandoffCapsuleItemV1,
  HandoffSourceReadGrant,
} from "@synara/contracts";
import { Cause, Effect, Option } from "effect";

import type { ProjectionSnapshotQueryShape } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  HostToolError,
  hostToolFailure as hostToolFailure,
  hostToolSuccess as hostToolSuccess,
  type HostToolEntry,
  type HostToolExecutionResult,
  type HostToolInvocationContext,
} from "../orchestration/hostTools/runtime.ts";
import { canonicalHandoffSourceItems, handoffSourceDigest } from "./handoffSourceMaterial.ts";

const MAX_ROWS = 50;
const MAX_RESULT_BYTES = 64 * 1024;

const objectSchema = (
  properties: Readonly<Record<string, unknown>>,
  required: ReadonlyArray<string> = [],
) => ({ type: "object", properties, required, additionalProperties: false }) as const;

const HANDOFF_TOOL_DEFINITIONS = [
  {
    name: "list_handoff_sources" as const,
    displayName: "List handoff sources",
    description: "List source grants authorized for this destination thread.",
    inputSchema: objectSchema({}),
    readOnly: true,
    providerSupport: { codex: "native" as const, claude: "unsupported" as const },
  },
  {
    name: "read_handoff_source" as const,
    displayName: "Read handoff source",
    description: "Read a bounded view of one destination-authorized frozen handoff source.",
    inputSchema: objectSchema(
      {
        grantId: { type: "string" },
        view: {
          type: "string",
          enum: [
            "status",
            "last_message",
            "tail_since_cursor",
            "transcript",
            "artifacts",
            "activity",
          ],
        },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_ROWS },
      },
      ["grantId", "view"],
    ),
    readOnly: true,
    providerSupport: { codex: "native" as const, claude: "unsupported" as const },
  },
  {
    name: "search_handoff_source" as const,
    displayName: "Search handoff source",
    description:
      "Search only content visible through one destination-authorized frozen source grant.",
    inputSchema: objectSchema(
      {
        grantId: { type: "string" },
        query: { type: "string", minLength: 1, maxLength: 1_024 },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      ["grantId", "query"],
    ),
    readOnly: true,
    providerSupport: { codex: "native" as const, claude: "unsupported" as const },
  },
] as const;

export const HANDOFF_DESTINATION_NATIVE_TOOL_CATALOG = HANDOFF_TOOL_DEFINITIONS;

interface CursorPayload {
  readonly grantId: string;
  readonly revision: number;
  readonly operation: string;
  readonly offset: number;
}

const encodeCursor = (payload: CursorPayload): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

function decodeCursor(value: unknown, grant: HandoffSourceReadGrant, operation: string): number {
  if (value === undefined) return 0;
  if (typeof value !== "string") {
    throw new HostToolError("handoff_cursor_invalid", "The handoff cursor must be a string.");
  }
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as CursorPayload;
    if (
      decoded.grantId !== grant.grantId ||
      decoded.revision !== grant.revision ||
      decoded.operation !== operation ||
      !Number.isInteger(decoded.offset) ||
      decoded.offset < 0
    ) {
      throw new Error("cursor scope mismatch");
    }
    return decoded.offset;
  } catch {
    throw new HostToolError(
      "handoff_cursor_invalid",
      "The handoff cursor is invalid or belongs to another grant revision.",
    );
  }
}

const readString = (args: Record<string, unknown>, name: string): string => {
  const value = args[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HostToolError("handoff_input_invalid", `'${name}' is required.`);
  }
  return value.trim();
};

const readLimit = (args: Record<string, unknown>, fallback: number, maximum: number): number => {
  const value = args.limit;
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new HostToolError(
      "handoff_input_invalid",
      `'limit' must be an integer between 1 and ${maximum}.`,
    );
  }
  return value;
};

function byteBounded<T>(
  items: ReadonlyArray<T>,
  limit: number,
): { items: ReadonlyArray<T>; omitted: number } {
  const result: T[] = [];
  let bytes = 0;
  for (const item of items.slice(0, limit)) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (result.length > 0 && bytes + itemBytes > MAX_RESULT_BYTES) break;
    result.push(item);
    bytes += itemBytes;
  }
  return { items: result, omitted: items.length - result.length };
}

interface AuthorizedSource {
  readonly handoff: AcceptedCrossModeHandoffV1;
  readonly grant: HandoffSourceReadGrant;
  readonly items: ReadonlyArray<HandoffCapsuleItemV1>;
  readonly currentSequence: number;
}

export function makeHandoffDestinationTools(input: {
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
}): ReadonlyArray<HostToolEntry> {
  const resolveDestinationHandoff = (context: HostToolInvocationContext) =>
    Effect.gen(function* () {
      const destinationOption = yield* input.snapshotQuery.getThreadDetailSnapshotById(
        context.callerThreadId as never,
      );
      if (Option.isNone(destinationOption)) return null;
      const handoff = destinationOption.value.thread.handoff?.crossMode ?? null;
      if (!handoff || handoff.grant.destinationThreadId !== context.callerThreadId) return null;
      return handoff;
    });

  const resolveAuthorizedSource = (
    args: Record<string, unknown>,
    context: HostToolInvocationContext,
  ): Effect.Effect<AuthorizedSource, HostToolError | unknown> =>
    Effect.gen(function* () {
      const handoff = yield* resolveDestinationHandoff(context);
      const grantId = readString(args, "grantId");
      if (!handoff || handoff.grant.grantId !== grantId) {
        return yield* Effect.fail(
          new HostToolError(
            "handoff_grant_not_found",
            "No source grant with that identifier is authorized for this destination thread.",
          ),
        );
      }
      if (handoff.grant.status !== "active") {
        return yield* Effect.fail(
          new HostToolError(
            `handoff_grant_${handoff.grant.status}`,
            `The handoff source grant is ${handoff.grant.status}.`,
          ),
        );
      }
      const sourceOption = yield* input.snapshotQuery.getThreadDetailSnapshotById(
        handoff.grant.sourceThreadId,
      );
      if (Option.isNone(sourceOption)) {
        return yield* Effect.fail(
          new HostToolError("handoff_source_missing", "The handoff source is no longer available."),
        );
      }
      const source = sourceOption.value;
      const items = canonicalHandoffSourceItems(source.thread.messages, handoff.capsule.sealedAt);
      if (handoffSourceDigest(items) !== handoff.sourceDigest) {
        return yield* Effect.fail(
          new HostToolError(
            "handoff_source_snapshot_changed",
            "The frozen source snapshot can no longer be reconstructed safely.",
          ),
        );
      }
      return {
        handoff,
        grant: handoff.grant,
        items,
        currentSequence: source.snapshotSequence,
      };
    });

  const metadata = (source: AuthorizedSource) => ({
    grantId: source.grant.grantId,
    sourceThreadId: source.grant.sourceThreadId,
    sourceTitle: source.handoff.sourceTitle,
    sourceMode: source.handoff.sourceMode,
    grantedThroughCursor: source.grant.grantedThroughCursor,
    revision: source.grant.revision,
    status: source.grant.status,
    hasNewerActivity: source.currentSequence > source.grant.grantedThroughCursor,
  });

  const visible = (context: HostToolInvocationContext) =>
    resolveDestinationHandoff(context).pipe(
      Effect.map((handoff) => handoff !== null && handoff.grant.status !== "revoked"),
      Effect.catch(() => Effect.succeed(false)),
    );

  const executeSafely = (
    effect: Effect.Effect<HostToolExecutionResult, unknown>,
  ): Effect.Effect<HostToolExecutionResult> =>
    effect.pipe(Effect.catchCause((cause) => Effect.succeed(hostToolFailure(Cause.squash(cause)))));

  return [
    {
      definition: HANDOFF_TOOL_DEFINITIONS[0],
      isVisible: visible,
      execute: (_args, context) =>
        executeSafely(
          Effect.gen(function* () {
            const handoff = yield* resolveDestinationHandoff(context);
            if (!handoff || handoff.grant.status === "revoked") {
              return hostToolSuccess([]);
            }
            const sourceOption = yield* input.snapshotQuery.getThreadDetailSnapshotById(
              handoff.grant.sourceThreadId,
            );
            return hostToolSuccess([
              {
                grantId: handoff.grant.grantId,
                sourceThreadId: handoff.grant.sourceThreadId,
                sourceTitle: handoff.sourceTitle,
                sourceMode: handoff.sourceMode,
                grantedThroughCursor: handoff.grant.grantedThroughCursor,
                revision: handoff.grant.revision,
                status: handoff.grant.status,
                hasNewerActivity:
                  Option.isSome(sourceOption) &&
                  sourceOption.value.snapshotSequence > handoff.grant.grantedThroughCursor,
              },
            ]);
          }),
        ),
    },
    {
      definition: HANDOFF_TOOL_DEFINITIONS[1],
      isVisible: visible,
      execute: (args, context) =>
        executeSafely(
          Effect.gen(function* () {
            const source = yield* resolveAuthorizedSource(args, context);
            const view = readString(args, "view");
            if (!source.grant.allowedViews.includes(view as never)) {
              return hostToolFailure(
                new HostToolError(
                  "handoff_view_denied",
                  `The '${view}' view is not authorized by this grant.`,
                ),
              );
            }
            if (view === "status") return hostToolSuccess(metadata(source));
            if (view === "last_message") {
              return hostToolSuccess({
                ...metadata(source),
                item: source.items.at(-1) ?? null,
              });
            }
            if (view === "artifacts" || view === "activity") {
              return hostToolSuccess({
                ...metadata(source),
                items: [],
                nextCursor: null,
                omissions: [`${view} material is not present in this frozen handoff snapshot.`],
              });
            }
            if (view !== "transcript" && view !== "tail_since_cursor") {
              return hostToolFailure(
                new HostToolError("handoff_view_invalid", `Unknown handoff view '${view}'.`),
              );
            }
            const offset = decodeCursor(args.cursor, source.grant, view);
            const limit = readLimit(args, 20, MAX_ROWS);
            const page = byteBounded(source.items.slice(offset), limit);
            const nextOffset = offset + page.items.length;
            return hostToolSuccess({
              ...metadata(source),
              items: page.items,
              nextCursor:
                nextOffset < source.items.length
                  ? encodeCursor({
                      grantId: source.grant.grantId,
                      revision: source.grant.revision,
                      operation: view,
                      offset: nextOffset,
                    })
                  : null,
              omissions:
                page.omitted > 0 ? [`${page.omitted} rows omitted by page or byte limits.`] : [],
            });
          }),
        ),
    },
    {
      definition: HANDOFF_TOOL_DEFINITIONS[2],
      isVisible: visible,
      execute: (args, context) =>
        executeSafely(
          Effect.gen(function* () {
            const source = yield* resolveAuthorizedSource(args, context);
            const query = readString(args, "query").toLocaleLowerCase();
            const offset = decodeCursor(args.cursor, source.grant, "search");
            const limit = readLimit(args, 8, 20);
            const matches = source.items.filter((item) =>
              item.text.toLocaleLowerCase().includes(query),
            );
            const page = byteBounded(matches.slice(offset), limit);
            const nextOffset = offset + page.items.length;
            return hostToolSuccess({
              ...metadata(source),
              items: page.items.map((item) => ({
                ref: item.ref,
                role: item.role,
                createdAt: item.createdAt,
                snippet: item.text.slice(0, 1_024),
              })),
              nextCursor:
                nextOffset < matches.length
                  ? encodeCursor({
                      grantId: source.grant.grantId,
                      revision: source.grant.revision,
                      operation: "search",
                      offset: nextOffset,
                    })
                  : null,
              omissions:
                page.omitted > 0 ? [`${page.omitted} matches omitted by page or byte limits.`] : [],
            });
          }),
        ),
    },
  ];
}
