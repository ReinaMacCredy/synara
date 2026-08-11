import "../../index.css";

import { DEFAULT_SERVER_SETTINGS, type ModelSlug, ThreadId } from "@veylen/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { serverQueryKeys } from "~/lib/serverReactQuery";

const harness = vi.hoisted(() => ({
  onContinue: vi.fn(),
}));

vi.mock("~/hooks/useProviderModelCatalog", () => ({
  useProviderModelCatalog: () => ({
    modelOptionsByProvider: {
      codex: [
        { slug: "gpt-5.6-luna" as ModelSlug, name: "GPT-5.6 Luna" },
        { slug: "gpt-5.6-sol" as ModelSlug, name: "GPT-5.6 Sol" },
      ],
    },
    loadingModelProviders: {},
    runtimeModelsByProvider: {
      claudeAgent: [],
      codex: [
        {
          slug: "gpt-5.6-luna",
          name: "GPT-5.6 Luna",
          supportedReasoningEfforts: [
            { value: "low", label: "Low" },
            { value: "medium", label: "Medium" },
            { value: "high", label: "High" },
          ],
          defaultReasoningEffort: "high",
        },
      ],
      cursor: [],
      antigravity: [],
      grok: [],
      droid: [],
      kilo: [],
      opencode: [],
      pi: [],
    },
  }),
}));

import { CrossModeHandoffDialog } from "./CrossModeHandoffDialog";

describe("CrossModeHandoffDialog", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    harness.onContinue.mockReset();
  });

  it("submits the model selected for this handoff with the configured provider and effort", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(serverQueryKeys.settings(), {
      ...DEFAULT_SERVER_SETTINGS,
      handoffAgent: {
        provider: "codex",
        model: "gpt-5.6-luna",
        effort: "high",
        customGuidance: "",
      },
    });
    harness.onContinue.mockResolvedValue(undefined);

    const screen = await render(
      <QueryClientProvider client={queryClient}>
        <CrossModeHandoffDialog
          open
          threadId={ThreadId.makeUnsafe("handoff-source-thread")}
          destinationLabel="Supervised"
          onOpenChange={() => undefined}
          onContinue={harness.onContinue}
        />
      </QueryClientProvider>,
    );

    try {
      const picker = page.getByRole("button", { name: "Change model and reasoning" });
      expect(picker.element().textContent).toContain("GPT-5.6 Luna");
      expect(picker.element().textContent).toContain("High");
      expect(picker.element().querySelector("svg")).not.toBeNull();

      await picker.click();
      await page.getByRole("menuitemradio", { name: "Medium" }).click();
      await picker.click();
      await page.getByRole("menuitem", { name: "GPT-5.6 Luna" }).click();
      await page.getByRole("menuitemradio", { name: "GPT-5.6 Sol" }).click();
      await page.getByRole("button", { name: "Continue in Supervised" }).click();

      await vi.waitFor(() => {
        expect(harness.onContinue).toHaveBeenCalledWith("", {
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "medium",
        });
      });
      expect(queryClient.getQueryData(serverQueryKeys.settings())).toMatchObject({
        handoffAgent: { model: "gpt-5.6-luna" },
      });
    } finally {
      await screen.unmount();
      queryClient.clear();
    }
  });
});
