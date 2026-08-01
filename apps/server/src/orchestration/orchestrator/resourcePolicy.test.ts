import { describe, expect, it } from "vitest";

import {
  cacheTelemetryFact,
  ORCHESTRATOR_RESOURCE_POLICY_V1,
  resourceCeilingViolations,
} from "./resourcePolicy.ts";

describe("Orchestrator resource policy", () => {
  it("reports hard-ceiling violations without choosing a semantic recovery", () => {
    expect(
      resourceCeilingViolations({
        activeSessions: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions + 1,
        messageBytes: ORCHESTRATOR_RESOURCE_POLICY_V1.maxMessageBytes,
        hopCount: ORCHESTRATOR_RESOURCE_POLICY_V1.maxHopCount + 1,
      }),
    ).toEqual([
      {
        ceiling: "maxActiveSessions",
        observed: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions + 1,
        limit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxActiveSessions,
      },
      {
        ceiling: "maxHopCount",
        observed: ORCHESTRATOR_RESOURCE_POLICY_V1.maxHopCount + 1,
        limit: ORCHESTRATOR_RESOURCE_POLICY_V1.maxHopCount,
      },
    ]);
  });

  it("keeps absent TTL unknown and reports expiration mechanically", () => {
    expect(
      cacheTelemetryFact({
        observedAt: "2026-08-01T00:00:00.000Z",
        now: "2026-08-01T00:00:01.000Z",
        ttlSeconds: null,
      }).state,
    ).toBe("unknown");
    expect(
      cacheTelemetryFact({
        observedAt: "2026-08-01T00:00:00.000Z",
        now: "2026-08-01T00:05:00.000Z",
        ttlSeconds: 60,
      }).state,
    ).toBe("expired");
  });
});
