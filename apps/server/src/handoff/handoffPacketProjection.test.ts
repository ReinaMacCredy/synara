import { describe, expect, it } from "vitest";

import { projectHandoffPacketSourceReferences } from "./handoffPacketProjection.ts";

describe("projectHandoffPacketSourceReferences", () => {
  it("derives citation kinds from sealed source material instead of model-authored labels", () => {
    const projected = projectHandoffPacketSourceReferences(
      {
        citations: [
          { ref: "message:user:1", kind: "user_message", label: "Owner request" },
          { ref: "message:assistant:2", kind: "assistant_message", label: "Agent reply" },
          { ref: "note:3", kind: "context_note", label: "Pinned note" },
        ],
      },
      [
        {
          ref: "message:user:1",
          role: "user",
          text: "Do the work",
          createdAt: "2026-08-02T00:00:00.000Z",
        },
        {
          ref: "message:assistant:2",
          role: "assistant",
          text: "Done",
          createdAt: "2026-08-02T00:00:01.000Z",
        },
        {
          ref: "note:3",
          role: "note",
          text: "Remember this",
          createdAt: "2026-08-02T00:00:02.000Z",
        },
      ],
    );

    expect(projected).toMatchObject({
      citations: [
        { ref: "message:user:1", kind: "message" },
        { ref: "message:assistant:2", kind: "message" },
        { ref: "note:3", kind: "note" },
      ],
    });
  });

  it("normalizes only uniquely resolvable legacy message citation aliases", () => {
    const projected = projectHandoffPacketSourceReferences(
      {
        objective: {
          text: "Continue the source work",
          claimType: "fact",
          citations: ["message:assistant:msg-1", "message:missing"],
        },
        citations: [
          { ref: "message:assistant:msg-1", kind: "message", label: "Agent reply" },
          { ref: "message:missing", kind: "message", label: "Unknown" },
        ],
      },
      [
        {
          ref: "message:msg-1",
          role: "assistant",
          text: "Continue here",
          createdAt: "2026-08-02T00:00:00.000Z",
        },
      ],
    );

    expect(projected).toMatchObject({
      objective: { citations: ["message:msg-1", "message:missing"] },
      citations: [{ ref: "message:msg-1" }, { ref: "message:missing" }],
    });
  });

  it("accepts the unqualified alias of a role-qualified canonical message ref", () => {
    const projected = projectHandoffPacketSourceReferences(
      {
        objective: {
          text: "Continue the source work",
          claimType: "fact",
          citations: ["message:msg-1"],
        },
        citations: [{ ref: "message:msg-1", kind: "message", label: "Agent reply" }],
      },
      [
        {
          ref: "message:assistant:msg-1",
          role: "assistant",
          text: "Continue here",
          createdAt: "2026-08-02T00:00:00.000Z",
        },
      ],
    );

    expect(projected).toMatchObject({
      objective: { citations: ["message:assistant:msg-1"] },
      citations: [{ ref: "message:assistant:msg-1", kind: "message" }],
    });
  });
});
