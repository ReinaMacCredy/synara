// FILE: CursorAdapter.test.ts
// Purpose: Characterizes Cursor's private Veylen host-policy delivery.
// Layer: Provider adapter tests

import { VEYLEN_HARNESS_POLICY_MARKER } from "../../agentGateway/harnessPolicy.ts";
import { describe, expect, it } from "vitest";

import { takeCursorVeylenHarnessPolicyTextPart } from "./CursorAdapter.ts";

describe("Cursor Veylen harness policy", () => {
  it("delivers scoped MCP host context exactly once per fresh/load/fork session", () => {
    for (const lifecycle of ["fresh", "load", "fork"] as const) {
      const state: { harnessPolicyDelivered?: boolean } = {};
      const first = takeCursorVeylenHarnessPolicyTextPart(state, true);
      expect(first?.text, lifecycle).toContain(VEYLEN_HARNESS_POLICY_MARKER);
      expect(first?.text, lifecycle).toContain("Use the veylen_* tools");
      expect(takeCursorVeylenHarnessPolicyTextPart(state, true), lifecycle).toBeNull();
    }
  });

  it("stays truthful without a scoped gateway connection", () => {
    expect(takeCursorVeylenHarnessPolicyTextPart({}, false)?.text).toContain(
      "Veylen MCP control is unavailable",
    );
  });
});
