import { describe, expect, it, vi } from "vitest";

import type { AppRouter } from "../router";
import { preloadRouteChunk } from "./usePreloadRouteChunks";

describe("preloadRouteChunk", () => {
  it("loads the lazy route chunk without creating a speculative route match", async () => {
    const settingsRoute = { id: "/_chat/settings" };
    const loadRouteChunk = vi.fn().mockResolvedValue(undefined);
    const preloadRoute = vi.fn();
    const router = {
      loadRouteChunk,
      preloadRoute,
      routesByPath: { "/settings": settingsRoute },
    } as unknown as AppRouter;

    await preloadRouteChunk(router, "/settings");

    expect(loadRouteChunk).toHaveBeenCalledOnce();
    expect(loadRouteChunk).toHaveBeenCalledWith(settingsRoute);
    expect(preloadRoute).not.toHaveBeenCalled();
  });

  it("treats an unavailable route as an optional warmup", async () => {
    const loadRouteChunk = vi.fn();
    const router = {
      loadRouteChunk,
      routesByPath: {},
    } as unknown as AppRouter;

    await expect(preloadRouteChunk(router, "/$threadId")).resolves.toBeUndefined();
    expect(loadRouteChunk).not.toHaveBeenCalled();
  });
});
