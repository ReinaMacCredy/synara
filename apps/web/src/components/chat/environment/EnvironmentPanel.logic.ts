import type { SessionProgressProjection } from "@synara/contracts";

export function shouldRenderEnvironmentProgress(
  projection: SessionProgressProjection | null,
): projection is SessionProgressProjection {
  return projection !== null;
}
