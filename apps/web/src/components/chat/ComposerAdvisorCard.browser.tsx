import "../../index.css";

import { ThreadId } from "@synara/contracts";
import { page } from "vitest/browser";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { DISCLOSURE_CLEANUP_BUFFER_MS, DISCLOSURE_TRANSITION_MS } from "~/lib/disclosureMotion";
import type { AdvisorConsultation } from "~/lib/advisorConsultation";
import { buildPendingUserInputAdvisorQuestion } from "~/pendingUserInputAdvisor";
import { ComposerAdvisorCard, ComposerAdvisorCardPresence } from "./ComposerAdvisorCard";
import { ComposerColumnFrame } from "./ComposerColumnFrame";

const pendingQuestion = {
  id: "scope",
  header: "Scope",
  question: "Which option should I use for this test?",
  options: [
    { label: "Option A", description: "Return the safer first choice." },
    { label: "Option B", description: "Return the faster second choice." },
  ],
} as const;

function consultation(overrides?: Partial<AdvisorConsultation>): AdvisorConsultation {
  return {
    threadId: ThreadId.makeUnsafe("advisor-thread"),
    question: "Should we keep the adapter boundary?",
    answer: null,
    answerStreaming: false,
    error: null,
    status: "running",
    ...overrides,
  };
}

describe("ComposerAdvisorCard", () => {
  it("presents the real pending question without exposing internal protocol controls", async () => {
    const onUseInTask = vi.fn();
    const mounted = await render(
      <ComposerColumnFrame>
        <ComposerAdvisorCard
          consultation={consultation({
            question: buildPendingUserInputAdvisorQuestion(pendingQuestion, undefined),
            answer: "Option A\nIt keeps rollback simple.",
            status: "complete",
          })}
          onOpenThread={vi.fn()}
          onUseInTask={onUseInTask}
        />
      </ComposerColumnFrame>,
    );

    await expect.element(page.getByText(pendingQuestion.question)).toBeVisible();
    expect(mounted.container.textContent).not.toContain("SYNARA_PENDING_USER_INPUT_ADVISOR_V1");
    expect(mounted.container.textContent).not.toContain("Use in task");
    expect(onUseInTask).not.toHaveBeenCalled();
  });

  it("retains the card through its bottom-origin close transition", async () => {
    const advisorConsultation = consultation();
    const renderPresence = (open: boolean) => (
      <ComposerColumnFrame>
        <ComposerAdvisorCardPresence
          consultation={advisorConsultation}
          open={open}
          onOpenThread={vi.fn()}
          onUseInTask={vi.fn()}
        />
      </ComposerColumnFrame>
    );
    const mounted = await render(renderPresence(true));

    await expect.element(page.getByTestId("composer-advisor-card")).toBeVisible();
    await mounted.rerender(renderPresence(false));

    await expect.poll(() => mounted.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    const closingShell = mounted.container.querySelector('[aria-hidden="true"]');
    expect(closingShell?.querySelector(".translate-y-3")).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="composer-advisor-card"]')).not.toBeNull();

    await new Promise((resolve) =>
      window.setTimeout(resolve, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS + 30),
    );
    expect(mounted.container.querySelector('[data-testid="composer-advisor-card"]')).toBeNull();
  });

  it("keeps the presence region open across consultation status ticks", async () => {
    const renderPresence = (next: AdvisorConsultation) => (
      <ComposerColumnFrame>
        <ComposerAdvisorCardPresence
          consultation={next}
          open
          onOpenThread={vi.fn()}
          onUseInTask={vi.fn()}
        />
      </ComposerColumnFrame>
    );

    const mounted = await render(renderPresence(consultation({ status: "running" })));

    await expect.element(page.getByTestId("composer-advisor-card")).toBeVisible();
    await expect
      .poll(
        () =>
          mounted.container
            .querySelector("[data-composer-advisor-card-presence]")
            ?.getAttribute("data-composer-advisor-card-presence"),
      )
      .toBe("open");

    const shellBefore = mounted.container.querySelector("[data-composer-advisor-card-presence]");
    await mounted.rerender(
      renderPresence(
        consultation({
          status: "complete",
          answer: "Option A\nIt keeps rollback simple.",
        }),
      ),
    );

    // Same presence host — content updates, no close/remount from status tick.
    expect(mounted.container.querySelector("[data-composer-advisor-card-presence]")).toBe(
      shellBefore,
    );
    expect(
      mounted.container
        .querySelector("[data-composer-advisor-card-presence]")
        ?.getAttribute("data-composer-advisor-card-presence"),
    ).toBe("open");
    await expect.element(page.getByText("Option A")).toBeVisible();
    // Disclosure shell must stay open (icons may still use aria-hidden).
    expect(
      mounted.container
        .querySelector("[data-composer-advisor-card-presence]")
        ?.querySelector('[aria-hidden="true"].grid'),
    ).toBeNull();
  });
});
