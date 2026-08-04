import "../../index.css";

import {
  ProjectId,
  SupervisionMissionId,
  SupervisorSeatId,
  type SupervisionMission,
} from "@synara/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { ComposerOrchestrationModeSwitch } from "../chat/ComposerOrchestrationModeSwitch";
import { MissionStrips } from "./MissionStrips";

const mission: SupervisionMission = {
  id: SupervisionMissionId.makeUnsafe("mission-release"),
  supervisorSeatId: SupervisorSeatId.makeUnsafe("supervisor-release"),
  brief: "Watch the release Lead and report the smallest material correction.",
  focus: "Backward compatibility",
  scope: [{ kind: "project", projectId: ProjectId.makeUnsafe("project-release") }],
  grants: ["lead.observe", "lead.advise"],
  endCondition: { kind: "manual" },
  status: "active",
  sourceMessageId: null,
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  completedAt: null,
  revision: 1,
};

describe("Supervised orchestration primitives", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the current draft mode and delegates its toggle", async () => {
    const onToggle = vi.fn();
    await render(
      <>
        <ComposerOrchestrationModeSwitch
          mode="supervise"
          title="Open an Orchestrate draft"
          onToggle={onToggle}
        />
        <button type="button">Outside mode switch</button>
      </>,
    );

    const modeSwitch = page.getByTestId("composer-orchestration-mode-switch");
    await expect.element(modeSwitch).toHaveAttribute("aria-pressed", "true");
    await expect.element(modeSwitch).toHaveAttribute("title", "Open an Orchestrate draft");
    await expect.element(modeSwitch).toHaveTextContent("Supervise");
    const modeSwitchElement = document.querySelector<HTMLElement>(
      '[data-testid="composer-orchestration-mode-switch"]',
    );
    expect(modeSwitchElement).not.toBeNull();
    const restingBackground = getComputedStyle(modeSwitchElement!).backgroundColor;
    expect(restingBackground).toBe("rgba(0, 0, 0, 0)");

    await modeSwitch.hover();
    await vi.waitFor(() => {
      expect(getComputedStyle(modeSwitchElement!).backgroundColor).not.toBe(restingBackground);
    });
    await page.getByRole("button", { name: "Outside mode switch" }).hover();
    await vi.waitFor(() => {
      expect(getComputedStyle(modeSwitchElement!).backgroundColor).toBe(restingBackground);
    });

    await modeSwitch.click();

    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("discloses mission scope and grants through the shared toggle motion", async () => {
    await render(<MissionStrips missions={[mission]} />);

    const missionButton = page.getByRole("button", { name: /Backward compatibility/u });
    await expect.element(missionButton).toHaveAttribute("aria-expanded", "false");
    await missionButton.click();
    await expect.element(missionButton).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByText("lead.observe")).toBeVisible();
    await expect.element(page.getByText("lead.advise")).toBeVisible();
  });
});
