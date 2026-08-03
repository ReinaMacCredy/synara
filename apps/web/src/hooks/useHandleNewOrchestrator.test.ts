import { ProjectId } from "@synara/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useComposerDraftStore } from "../composerDraftStore";
import { resetComposerDraftStore } from "../composerDraftStoreTestFixtures";
import type { Project } from "../types";
import { ensureOrchestratorDraft } from "./useHandleNewOrchestrator";

function makeProject(kind: Project["kind"]): Project {
  return {
    id: ProjectId.makeUnsafe(`${kind}-workspace`),
    kind,
    name: kind === "chat" ? "Home" : "Project",
    remoteName: kind === "chat" ? "Home" : "Project",
    folderName: kind,
    localName: null,
    cwd: `/tmp/${kind}-workspace`,
    defaultModelSelection: null,
    expanded: true,
    spaceId: null,
    scripts: [],
  };
}

describe("ensureOrchestratorDraft", () => {
  beforeEach(() => {
    resetComposerDraftStore();
  });

  it("retains an Orchestrator draft in the hidden managed chat workspace", () => {
    const project = makeProject("chat");

    const firstThreadId = ensureOrchestratorDraft({ project });
    const secondThreadId = ensureOrchestratorDraft({ project });
    const draft = useComposerDraftStore.getState().draftThreadsByThreadId[firstThreadId];

    expect(secondThreadId).toBe(firstThreadId);
    expect(draft).toMatchObject({
      projectId: project.id,
      entryPoint: "orchestrator",
      workingDirectory: project.cwd,
    });
  });

  it("rejects unsupported or empty workspace containers", () => {
    expect(() =>
      ensureOrchestratorDraft({ project: { ...makeProject("project"), cwd: "" } }),
    ).toThrow("active workspace container");
  });
});
