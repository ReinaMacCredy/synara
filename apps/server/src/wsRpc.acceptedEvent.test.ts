import { CommandId } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { findAcceptedAggregateEvent } from "./wsRpc";

describe("findAcceptedAggregateEvent", () => {
  it("finds the command event behind a later compound-command fence", () => {
    const commandId = CommandId.makeUnsafe("user:root-archive");
    const events = [
      {
        commandId: CommandId.makeUnsafe("synthetic:thread-archive"),
        sequence: 42,
      },
      { commandId, sequence: 41 },
    ];

    expect(findAcceptedAggregateEvent(events, commandId)).toEqual(events[1]);
  });
});
