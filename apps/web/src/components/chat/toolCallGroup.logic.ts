// FILE: toolCallGroup.logic.ts
// Purpose: Summarizes a settled run of tool-call work entries into one compact
//          label ("Loaded tools, read files") for the
//          collapsed tool-group disclosure in the transcript.
// Layer: Web chat presentation helpers
// Exports: MIN_COLLAPSIBLE_TOOL_GROUP_SIZE, ToolCallSummaryCategory,
//          ToolCallGroupSummary, isSummarizableToolCallEntry,
//          classifyToolCallSummaryCategory, summarizeToolCallGroup

import { isFileChangeWorkLogEntry, type WorkLogEntry } from "../../session-logic";
import { deriveReadableCommandDisplay } from "../../lib/toolCallLabel";
import { isReasoningUpdateWorkEntry } from "./agentActivity.logic";

export const MIN_COLLAPSIBLE_TOOL_GROUP_SIZE = 2;

// Singleton categories collapse even as one row (ChatGPT "Ran a command").
// Generic "tool"/MCP stays open as an individual icon row unless grouped (2+).
const SINGLETON_SUMMARY_CATEGORIES = new Set<ToolCallSummaryCategory>([
  "command",
  "edit",
  "read",
  "search",
  "web",
  "image",
]);

export type ToolCallSummaryCategory =
  | "command"
  | "edit"
  | "read"
  | "search"
  | "web"
  | "image"
  | "agent"
  | "tool"
  | "other";

export interface ToolCallGroupSummaryPart {
  category: ToolCallSummaryCategory;
  count: number;
  label: string;
}

export interface ToolCallGroupSummary {
  label: string;
  parts: ReadonlyArray<ToolCallGroupSummaryPart>;
  entryCount: number;
  // A group with in-flight work must never present itself as settled.
  hasRunningEntry: boolean;
}

// Rich rows (subagent strips, automation cards, thread-creation recaps) and
// non-tool tones (errors, approvals, info) must stay individually visible, so
// they never fold into a summary group.
export function isSummarizableToolCallEntry(entry: WorkLogEntry): boolean {
  return (
    entry.tone === "tool" &&
    !isReasoningUpdateWorkEntry(entry) &&
    !entry.veylenThreadCreation &&
    !entry.automation &&
    !entry.subagentAction &&
    (entry.subagents?.length ?? 0) === 0
  );
}

export function formatToolCallDetailLabel(entry: WorkLogEntry): string {
  const category = classifyToolCallSummaryCategory(entry);
  const command = entry.command ?? entry.rawCommand;
  const commandDisplay = command ? deriveReadableCommandDisplay(command) : null;

  switch (category) {
    case "read":
      return commandDisplay?.target
        ? `Read ${commandDisplay.target}`
        : entry.changedFiles?.[0]
          ? `Read ${entry.changedFiles[0].split("/").at(-1)}`
          : "Read a file";
    case "search":
      return commandDisplay?.target
        ? commandDisplay.target.startsWith("for ")
          ? `Searched ${commandDisplay.target}`
          : `Searched for ${commandDisplay.target}`
        : "Searched";
    case "command":
      return "Ran command";
    case "edit":
      return entry.changedFiles?.length === 1 ? `Edited ${entry.changedFiles[0]}` : "Edited files";
    case "web":
      return "Searched the web";
    case "image":
      return "Viewed an image";
    case "agent":
      return "Ran an agent task";
    case "tool":
      return (
        entry.toolTitle?.trim() || entry.label.trim() || entry.toolName?.trim() || "Used a tool"
      );
    case "other":
      return entry.toolTitle?.trim() || entry.label.trim() || "Ran a tool";
  }
}

const READ_VERBS = new Set(["Read", "Reading"]);
const SEARCH_VERBS = new Set(["Searched", "Searching", "Found", "Finding"]);

function classifyCommandVerb(verb: string): ToolCallSummaryCategory {
  if (READ_VERBS.has(verb)) return "read";
  if (SEARCH_VERBS.has(verb)) return "search";
  return "command";
}

export function classifyToolCallSummaryCategory(entry: WorkLogEntry): ToolCallSummaryCategory {
  if (entry.requestKind === "file-read") {
    return "read";
  }
  if (
    entry.itemType === "mcp_tool_call" ||
    entry.itemType === "dynamic_tool_call" ||
    entry.toolName ||
    entry.toolTitle?.toLowerCase().includes("mcp__")
  ) {
    return "tool";
  }
  if (isFileChangeWorkLogEntry(entry)) {
    return "edit";
  }
  if (entry.itemType === "web_search") {
    return "web";
  }
  if (entry.itemType === "image_view" || entry.itemType === "image_generation") {
    return "image";
  }
  const command = entry.command ?? entry.rawCommand;
  if (entry.itemType === "command_execution" || entry.requestKind === "command" || command) {
    if (command) {
      return classifyCommandVerb(deriveReadableCommandDisplay(command).verb);
    }
    // Structured command actions (e.g. Codex read/search) carry the verb as the
    // derived tool title without any shell command string.
    const titleVerb = entry.toolTitle?.trim().split(/\s+/, 1)[0] ?? "";
    return classifyCommandVerb(titleVerb);
  }
  if (entry.itemType === "collab_agent_tool_call") {
    return "agent";
  }
  return "other";
}

// Distinct-file identity for an edit/read entry. Entries with no file info
// count as one unit each so the total never under-reports work.
function entryFileKeys(entry: WorkLogEntry): ReadonlyArray<string> {
  if (entry.changedFiles && entry.changedFiles.length > 0) {
    return entry.changedFiles;
  }
  const detailFiles = entry.toolDetails?.files;
  if (detailFiles && detailFiles.length > 0) {
    return detailFiles;
  }
  const command = entry.command ?? entry.rawCommand;
  if (command) {
    const target = deriveReadableCommandDisplay(command).target.trim();
    if (target.length > 0) {
      return [target];
    }
  }
  if (entry.preview?.trim()) {
    return [entry.preview.trim()];
  }
  return [];
}

// Labels match ChatGPT agentActivity.summary.* (leading form; mid-sentence
// casing is applied by sentenceJoin for non-first parts).
function summaryPartLabel(
  category: ToolCallSummaryCategory,
  count: number,
  isSolePart: boolean,
): string {
  switch (category) {
    case "command":
      return count === 1 ? "Ran a command" : "Ran commands";
    case "edit":
      return count === 1 ? "Edited a file" : "Edited files";
    case "read":
      // ChatGPT uses "Read files" even for the singular leading segment.
      return "Read files";
    case "search":
      return count === 1 ? "Searched once" : `${count} searches`;
    case "web":
      return count === 1 ? "Searched the web" : `Searched the web ${count} times`;
    case "image":
      return count === 1 ? "Viewed an image" : `Viewed ${count} images`;
    case "agent":
      return count === 1 ? "Ran an agent task" : `Ran ${count} agent tasks`;
    case "tool":
      return count === 1 ? "Loaded a tool" : "Loaded tools";
    case "other":
      return isSolePart
        ? count === 1
          ? "Ran a tool"
          : `Ran ${count} tools`
        : count === 1
          ? "Ran another tool"
          : `Ran ${count} other tools`;
  }
}

function sentenceJoin(parts: ReadonlyArray<ToolCallGroupSummaryPart>): string {
  return parts
    .map((part, index) => {
      if (index === 0) return part.label;
      return `${part.label.charAt(0).toLowerCase()}${part.label.slice(1)}`;
    })
    .join(", ");
}

export function summarizeToolCallGroup(
  entries: ReadonlyArray<WorkLogEntry>,
): ToolCallGroupSummary | null {
  const summarizable = entries.filter(isSummarizableToolCallEntry);
  if (summarizable.length === 0) {
    return null;
  }
  if (
    summarizable.length < MIN_COLLAPSIBLE_TOOL_GROUP_SIZE &&
    !SINGLETON_SUMMARY_CATEGORIES.has(classifyToolCallSummaryCategory(summarizable[0]!))
  ) {
    return null;
  }

  const countByCategory = new Map<ToolCallSummaryCategory, number>();
  const distinctFilesByCategory = new Map<ToolCallSummaryCategory, Set<string>>();
  const categoryOrder: ToolCallSummaryCategory[] = [];
  let hasRunningEntry = false;

  for (const entry of summarizable) {
    if (entry.toolStatus === "running") {
      hasRunningEntry = true;
    }
    const category = classifyToolCallSummaryCategory(entry);
    if (!categoryOrder.includes(category)) {
      categoryOrder.push(category);
    }
    if (category === "edit" || category === "read") {
      const fileKeys = entryFileKeys(entry);
      if (fileKeys.length === 0) {
        countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
        continue;
      }
      const distinctFiles =
        distinctFilesByCategory.get(category) ??
        distinctFilesByCategory.set(category, new Set()).get(category)!;
      for (const fileKey of fileKeys) {
        distinctFiles.add(fileKey);
      }
      continue;
    }
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + 1);
  }

  for (const [category, distinctFiles] of distinctFilesByCategory) {
    countByCategory.set(category, (countByCategory.get(category) ?? 0) + distinctFiles.size);
  }

  const populated = categoryOrder.filter((category) => (countByCategory.get(category) ?? 0) > 0);
  const parts = populated.map((category) => {
    const count = countByCategory.get(category)!;
    return {
      category,
      count,
      label: summaryPartLabel(category, count, populated.length === 1),
    };
  });

  return {
    label: sentenceJoin(parts),
    parts,
    entryCount: summarizable.length,
    hasRunningEntry,
  };
}
