// FILE: SupervisedOperationsDock.test.tsx
// Purpose: Guards governed signal rendering in the Room operations dock.
// Layer: Component rendering tests
// Depends on: SupervisedOperationsDock and the supervised runtime snapshot contract.

import type { DerivedSignal } from "@synara/contracts";
import { emptySupervisedRuntimeSnapshot } from "@synara/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  conversationGroupForTopologyTarget,
  SupervisedOperationsDock,
} from "./SupervisedOperationsDock";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: useQueryMock,
}));

describe("SupervisedOperationsDock", () => {
  it("routes an acting-root Supervisor separately from a Room Lead", () => {
    expect(
      conversationGroupForTopologyTarget({ kind: "supervisor", sessionId: null }),
    ).toBe("supervisor");
    expect(conversationGroupForTopologyTarget({ kind: "lead", sessionId: null })).toBe(
      "lead",
    );
  });

  it("renders a governed signal with its threshold and delivery state", () => {
    const at = "2026-08-07T00:00:00.000Z";
    const signal: DerivedSignal = {
      id: "signal-context-pressure" as never,
      kind: "ContextPressureHigh",
      subscriptionId: "subscription-context-pressure" as never,
      scope: { kind: "room", roomId: "room-1" as never },
      subjectId: "lead-1",
      state: "triggered",
      measuredValue: 82,
      threshold: { operator: "gte", value: 80 },
      sourceEventIds: ["event-context-pressure" as never],
      metricSampleIds: ["metric-context-pressure" as never],
      aggregationReceiptHash: `sha256:${"a".repeat(64)}` as never,
      context: {},
      triggeredAt: at,
      resetAt: null,
      revision: 1,
    };
    useQueryMock.mockReturnValue({
      data: { ...emptySupervisedRuntimeSnapshot(at), signals: [signal] },
      isLoading: false,
    });

    const markup = renderToStaticMarkup(
      <SupervisedOperationsDock roomId="room-1" conversation={<div>Conversation</div>} />,
    );

    expect(markup).toContain("Lead context pressure high");
    expect(markup).toContain("Measured 82");
    expect(markup).toContain("threshold gte 80");
    expect(markup).toContain("Delivery not queued");
  });
});
