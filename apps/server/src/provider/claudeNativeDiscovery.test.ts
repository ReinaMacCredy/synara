import { describe, expect, it, vi } from "vitest";

import { ClaudeNativeDiscoveryState, mapClaudeModelInfo } from "./claudeNativeDiscovery";

describe("ClaudeNativeDiscoveryState", () => {
  it("deduplicates concurrent discovery and clears the in-flight promise after settlement", async () => {
    const state = new ClaudeNativeDiscoveryState();
    const start = vi.fn(async () => ({ models: [], source: "sdk", cached: false }) as const);
    const [first, second] = await Promise.all([
      state.discoverModels(start),
      state.discoverModels(start),
    ]);
    expect(first).toBe(second);
    expect(start).toHaveBeenCalledTimes(1);
    await state.discoverModels(start);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("returns cached results with explicit provenance and normalizes model capability", () => {
    const state = new ClaudeNativeDiscoveryState();
    const model = mapClaudeModelInfo({
      value: "claude-opus",
      displayName: "Claude Opus",
      description: "",
      supportsEffort: true,
      supportsAdaptiveThinking: true,
      supportsFastMode: false,
      supportsAutoMode: true,
    });
    state.setModels({ models: [model], source: "sdk", cached: false });
    expect(state.getModels()).toEqual({ models: [model], source: "sdk", cached: true });
    expect(model).toMatchObject({ slug: "claude-opus", supportsAutoMode: true });
  });
});
