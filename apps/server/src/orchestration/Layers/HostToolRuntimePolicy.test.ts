import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { SupervisedToolPolicy } from "@veylen/contracts";

import { evaluateSupervisedToolPolicy } from "./HostToolRuntime.ts";

const policy = (state: SupervisedToolPolicy["state"]): SupervisedToolPolicy => ({
  toolId: "supervised.topology.read",
  state,
  revision: 1,
  reason: null,
  updatedAt: "2026-08-09T09:00:00.000Z",
  revokedAt: state === "revoked" ? "2026-08-09T09:00:00.000Z" : null,
});

describe("Supervised Host-tool policy", () => {
  it("uses one fail-closed decision for injection and execution", () => {
    assert.deepEqual(evaluateSupervisedToolPolicy(undefined), { enabled: true });
    assert.deepEqual(evaluateSupervisedToolPolicy(policy("enabled")), { enabled: true });

    const disabled = evaluateSupervisedToolPolicy(policy("disabled"));
    assert.equal(disabled.enabled, false);
    if (!disabled.enabled) assert.equal(disabled.code, "supervised_tool_policy_disabled");

    const revoked = evaluateSupervisedToolPolicy(policy("revoked"));
    assert.equal(revoked.enabled, false);
    if (!revoked.enabled) assert.equal(revoked.code, "supervised_tool_policy_revoked");
  });
});
