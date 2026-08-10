import { describe, expect, it } from "vitest";

import { EDITOR_WORKSPACE_EXIT_MS, editorWorkspaceMotionClassName } from "./editorWorkspaceMotion";

describe("editor workspace motion", () => {
  it("uses one shared enter and exit contract for every workspace surface", () => {
    expect(editorWorkspaceMotionClassName(false)).toBe("editor-workspace-enter");
    expect(editorWorkspaceMotionClassName(true)).toBe("editor-workspace-exit");
    expect(EDITOR_WORKSPACE_EXIT_MS).toBe(160);
  });
});
