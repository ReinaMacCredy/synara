import {
  ADVISOR_CONSULTATION_MARKER,
  buildAdvisorConsultationPrompt,
} from "@veylen/shared/advisor";
import { describe, expect, it } from "vitest";

import type { WorkLogEntry } from "../session-logic";
import {
  advisorWorkEntryStatus,
  extractAdvisorWorkEntryAdvice,
  extractAdvisorWorkEntryQuestion,
  isAdvisorConsultationWorkEntry,
  workEntryMatchesAdvisorConsultation,
} from "./advisorWorkEntry";
// extractAdvisorWorkEntryAdvice already imported above

function makeEntry(overrides: Partial<WorkLogEntry> = {}): WorkLogEntry {
  return {
    id: "entry-1",
    createdAt: "2026-08-05T00:00:00.000Z",
    label: "Agent",
    tone: "tool",
    itemType: "collab_agent_tool_call",
    ...overrides,
  };
}

describe("advisorWorkEntry", () => {
  it("detects the veylen_consult_advisor gateway tool row", () => {
    const entry = makeEntry({
      itemType: "mcp_tool_call",
      toolName: "veylen_consult_advisor",
      toolTitle: "Asking Advisor",
      toolStatus: "completed",
      detail: JSON.stringify({
        status: "complete",
        question: "Keep the adapter?",
        advice: "Keep it for one release.",
        threadId: "advisor-child-1",
      }),
    });
    expect(isAdvisorConsultationWorkEntry(entry)).toBe(true);
    expect(extractAdvisorWorkEntryQuestion(entry)).toBe("Keep the adapter?");
    expect(extractAdvisorWorkEntryAdvice(entry)).toBe("Keep it for one release.");
  });

  it("detects advisor identity on subagents", () => {
    const entry = makeEntry({
      subagents: [
        {
          threadId: "child-1",
          nickname: "Advisor",
          role: "advisor",
          prompt: buildAdvisorConsultationPrompt("Keep the adapter?"),
        },
      ],
    });
    expect(isAdvisorConsultationWorkEntry(entry)).toBe(true);
    expect(extractAdvisorWorkEntryQuestion(entry)).toBe("Keep the adapter?");
  });

  it("returns null when no real question is available (never invents placeholder prose)", () => {
    expect(
      extractAdvisorWorkEntryQuestion(
        makeEntry({
          itemType: "mcp_tool_call",
          toolName: "veylen_consult_advisor",
          label: "Asking Advisor",
        }),
      ),
    ).toBeNull();
  });

  it("detects advisor consultation marker on the action prompt without subagent role yet", () => {
    const entry = makeEntry({
      subagentAction: {
        tool: "spawnAgent",
        status: "in_progress",
        summaryText: "Spawning 1 agent",
        prompt: buildAdvisorConsultationPrompt("Rewrite projection?"),
      },
    });
    expect(isAdvisorConsultationWorkEntry(entry)).toBe(true);
    expect(extractAdvisorWorkEntryQuestion(entry)).toBe("Rewrite projection?");
  });

  it("does not treat ordinary agent tasks as advisor consultations", () => {
    const entry = makeEntry({
      subagents: [{ threadId: "worker-1", nickname: "explorer", role: "worker" }],
      subagentAction: {
        tool: "spawnAgent",
        status: "in_progress",
        summaryText: "Spawning 1 agent",
        prompt: "Explore the changelog",
      },
    });
    expect(isAdvisorConsultationWorkEntry(entry)).toBe(false);
  });

  it("maps tool/live status to presentation status", () => {
    expect(advisorWorkEntryStatus(makeEntry({ toolStatus: "running" }))).toBe("running");
    expect(advisorWorkEntryStatus(makeEntry({ toolStatus: "completed" }))).toBe("complete");
    expect(advisorWorkEntryStatus(makeEntry({ toolStatus: "failed" }))).toBe("error");
    expect(
      advisorWorkEntryStatus(
        makeEntry({
          liveActivity: {
            state: "cancelled",
            label: "Cancelled",
            lastActivityAt: "2026-08-05T00:00:01.000Z",
          },
        }),
      ),
    ).toBe("stopped");
  });

  it("uses completed detail as advice and ignores the marker prompt", () => {
    const entry = makeEntry({
      toolStatus: "completed",
      detail: "Keep the adapter for one release.",
      subagentAction: {
        tool: "spawnAgent",
        status: "completed",
        summaryText: "Spawning 1 agent",
        prompt: buildAdvisorConsultationPrompt("Keep the adapter?"),
      },
    });
    expect(extractAdvisorWorkEntryAdvice(entry)).toBe("Keep the adapter for one release.");
    expect(
      extractAdvisorWorkEntryAdvice({
        detail: `${ADVISOR_CONSULTATION_MARKER}\nnope`,
        tone: "tool",
        toolStatus: "completed",
      }),
    ).toBeNull();
  });

  it("matches consultations by thread id or question text", () => {
    const entry = makeEntry({
      subagents: [
        {
          threadId: "provider-child",
          resolvedThreadId: "veylen-child",
          nickname: "Advisor",
          role: "advisor",
          prompt: buildAdvisorConsultationPrompt("Ship tonight?"),
        },
      ],
    });
    expect(
      workEntryMatchesAdvisorConsultation(entry, {
        threadId: "veylen-child",
        question: "Ship tonight?",
      }),
    ).toBe(true);
    expect(
      workEntryMatchesAdvisorConsultation(entry, {
        threadId: "other",
        question: "Ship tonight?",
      }),
    ).toBe(true);
    expect(
      workEntryMatchesAdvisorConsultation(entry, {
        threadId: "other",
        question: "Different question",
      }),
    ).toBe(false);
  });
});
