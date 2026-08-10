import type { SessionProgressProjection } from "@veylen/contracts";

export function shouldRenderEnvironmentProgress(
  projection: SessionProgressProjection | null,
): projection is SessionProgressProjection {
  return projection !== null;
}
