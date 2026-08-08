import { describe, expect, it } from "vitest";

import { isEditorWorkspaceLocation } from "./editorWorkspaceRoute";

describe("chat route workspace shell", () => {
  it("suppresses the thread sidebar for Normal editor view", () => {
    expect(isEditorWorkspaceLocation({ pathname: "/thread-1", view: "editor" })).toBe(true);
  });

  it("suppresses the thread sidebar for an exact Supervised Room view", () => {
    expect(isEditorWorkspaceLocation({ pathname: "/supervised/room-1" })).toBe(true);
    expect(isEditorWorkspaceLocation({ pathname: "/supervised/room-1/" })).toBe(true);
  });

  it("restores the thread sidebar when a Supervised Room switches back to chat", () => {
    expect(isEditorWorkspaceLocation({ pathname: "/supervised/room-1", view: "chat" })).toBe(
      false,
    );
  });

  it("keeps the sidebar on the Supervised composer and nested task routes", () => {
    expect(isEditorWorkspaceLocation({ pathname: "/supervised" })).toBe(false);
    expect(isEditorWorkspaceLocation({ pathname: "/supervised/room-1/tasks/task-1" })).toBe(false);
  });
});
