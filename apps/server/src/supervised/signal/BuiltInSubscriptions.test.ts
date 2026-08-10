import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { builtInEventSchemas, builtInSubscriptions } from "./BuiltInSubscriptions.ts";

const now = "2026-08-10T00:00:00.000Z";

describe("built-in signal subscriptions", () => {
  it("retains Room and Lead routing evidence on canonical review facts", () => {
    const schemas = builtInEventSchemas(now);
    for (const eventType of ["ReviewCompleted", "ReviewRejected"]) {
      const schema = schemas.find((candidate) => candidate.eventType === eventType);
      assert.ok(schema);
      const fields = (schema.jsonSchema as { readonly fields?: Record<string, string> }).fields;
      assert.equal(fields?.roomId, "internal");
      assert.equal(fields?.leadSeatId, "internal");
    }
  });

  it("routes both built-ins by Supervisor concern with bounded cooldown", () => {
    const [review, context] = builtInSubscriptions(now);
    assert.deepEqual(review?.destination, { kind: "concern", concern: "delivery" });
    assert.deepEqual(context?.destination, { kind: "concern", concern: "context" });
    assert.equal(review?.ownerLeadSeatId, null);
    assert.equal(context?.ownerLeadSeatId, null);
    assert.equal(review?.cooldownMs, 600_000);
    assert.equal(context?.cooldownMs, 600_000);
  });
});
