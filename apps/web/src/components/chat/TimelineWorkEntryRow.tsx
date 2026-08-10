// FILE: TimelineWorkEntryRow.tsx
// Purpose: Renders transcript work/tool rows and their inline details.
// Layer: Web chat presentation component
// Exports: TimelineWorkEntryRow, EditedFileRowContent, prefersCompactWorkEntryRow

import type { ThreadId, TurnId } from "@veylen/contracts";
import { BookOpen, Globe, Images, Pencil, Search, SquareTerminal, Wrench } from "lucide-react";
import {
  createElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { basenameOfPath } from "~/file-icons";
import type { TimestampFormat } from "../../appSettings";
import {
  ArrowUpCircleIcon,
  BackgroundTrayIcon,
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleQuestionIcon,
  GitHubIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  McpIcon,
  PencilIcon,
  ZapIcon,
} from "~/lib/icons";
import { describeLinkChip } from "~/lib/linkChips";
import { cn } from "~/lib/utils";

import { isFileChangeWorkLogEntry, type WorkLogEntry } from "../../session-logic";
import {
  formatAgentActivityEntryPreview,
  isAgentActivityWorkEntry,
  isCodexActivityStatusWorkEntry,
  isReasoningUpdateWorkEntry,
} from "./agentActivity.logic";
import { isAdvisorConsultationWorkEntry } from "~/lib/advisorWorkEntry";
import { AutomationCreatedCard } from "./AutomationCreatedCard";
import { AdvisorConsultationWorkRow } from "./AdvisorConsultationWorkRow";
import ChatMarkdown from "../ChatMarkdown";
import { DiffStatLabel } from "./DiffStatLabel";
import { type ExpandedImagePreview } from "./ExpandedImagePreview";
import { LinkChipIcon } from "../LinkChipIcon";
import { VeylenLogo } from "../VeylenLogo";
import { normalizeCompactToolLabel } from "./MessagesTimeline.logic";
import { formatToolCallDetailLabel, isSummarizableToolCallEntry } from "./toolCallGroup.logic";
import { ToolCallDetailsContent } from "./ToolCallDetailsDialog";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { fileDiffStatsByPath, resolveFileDiffStatByChangedPath } from "~/lib/diffRendering";
import {
  extractToolArgumentField,
  isPrefixedToolArgumentSummary,
} from "../../lib/toolArgumentSummary";
import {
  deriveFriendlyCommandTarget,
  deriveVeylenMcpToolTitle,
  extractWebFetchUrl,
  isVeylenBrowserToolCall,
  normalizeToolTextForComparison,
  resolveCommandVisualKind,
  sanitizeVeylenMcpToolPreview,
  type VeylenMcpToolStatus,
} from "../../lib/toolCallLabel";
import {
  formatLiveActivityMeta,
  formatLiveActivityPrimary,
  isLiveActivityInProgress,
  useLiveActivityNow,
} from "../../lib/liveActivityPresentation";
import { openWorkspaceFileReference, useWorkspaceFileOpener } from "../../lib/workspaceFileOpener";

const TRANSCRIPT_DISCLOSURE_TRANSITION_MS = 220;
const TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS = 40;
const WORK_ROW_MUTED_HOVER_TONE: Record<"tool-row" | "file-row", string> = {
  "tool-row":
    "text-muted-foreground/70 transition-colors group-hover/tool-row:text-foreground group-focus-visible/tool-row:text-foreground",
  "file-row":
    "text-muted-foreground/70 transition-colors group-hover/file-row:text-foreground group-focus-visible/file-row:text-foreground",
};
const EMPTY_FILE_DIFF_STATS: ReadonlyMap<string, { additions: number; deletions: number }> =
  new Map();

type TimelineWorkEntry = WorkLogEntry;

const AgentTaskIcon: LucideIcon = (props) => <BotIcon {...props} />;
const VeylenToolIcon: LucideIcon = ({ className, ...props }) => (
  <VeylenLogo {...props} className={cn("text-current", className)} />
);
const ToolWrenchIcon: LucideIcon = (props) => <Wrench {...props} strokeWidth={2} />;
const ToolReadIcon: LucideIcon = (props) => <BookOpen {...props} strokeWidth={2} />;
const ToolSearchIcon: LucideIcon = (props) => <Search {...props} strokeWidth={2} />;
const ToolCommandIcon: LucideIcon = (props) => <SquareTerminal {...props} strokeWidth={2} />;
const ToolImagesIcon: LucideIcon = (props) => <Images {...props} strokeWidth={2} />;
const ToolEditIcon: LucideIcon = (props) => <Pencil {...props} strokeWidth={2} />;
const ToolWebIcon: LucideIcon = (props) => <Globe {...props} strokeWidth={2} />;

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-muted-foreground/50",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-muted-foreground/40",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-muted-foreground/50",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-muted-foreground/45",
  };
}

/**
 * Try to extract a clean file path from a detail string that may contain JSON.
 * Handles patterns like:
 *   Read {"file_path":"/Users/foo/bar.ts","offset":10}
 *   {"file_path":"/path/to/file.ts"}
 */
function extractFilePathFromDetail(detail: string): string | null {
  const plainPathMatch = /^(.+?\.[A-Za-z0-9][A-Za-z0-9._-]*)(?::\d+)?(?::\d+)?$/u.exec(
    detail.trim(),
  );
  if (plainPathMatch?.[1]?.includes("/")) {
    return plainPathMatch[1].trim();
  }
  // "path" is generic enough that a nested match (e.g. inside a config object)
  // may not be the file the tool acted on — only regex-scan truncated JSON.
  return extractToolArgumentField(detail, ["file_path", "filePath", "path", "filename"], {
    fallbackScan: "whenUnparsed",
  });
}

function workEntryPreview(workEntry: TimelineWorkEntry): string | null {
  if (isReasoningUpdateWorkEntry(workEntry)) {
    return formatAgentActivityEntryPreview(workEntry);
  }
  const isFileRelated =
    workEntry.requestKind === "file-read" ||
    workEntry.requestKind === "file-change" ||
    workEntry.itemType === "file_change";

  if (workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand) {
    const command = workEntry.command ?? workEntry.rawCommand;
    // Running and settled command rows share one target so the row text only
    // swaps tense ("Searching for foo in src" → "Searched for foo in src").
    if (command) return deriveFriendlyCommandTarget(command);
  }

  if (workEntry.preview) return workEntry.preview;

  // Prefer clean basenames from changedFiles
  if (workEntry.changedFiles && workEntry.changedFiles.length > 0) {
    const names = workEntry.changedFiles.map((p) => basenameOfPath(p));
    if (names.length === 1) return names[0]!;
    return `${names.length} files`;
  }

  if (workEntry.itemType === "collab_agent_tool_call") {
    return workEntry.detail ?? workEntry.subagentAction?.prompt ?? null;
  }

  // For detail, try to extract a clean file path first
  if (workEntry.detail) {
    const filePath = extractFilePathFromDetail(workEntry.detail);
    if (filePath) return basenameOfPath(filePath);

    // For file-related entries, the heading alone is enough — don't show raw JSON
    if (isFileRelated) return null;

    // For other entries, if the detail looks like raw JSON, skip it
    const trimmedDetail = workEntry.detail.trim();
    if (trimmedDetail.startsWith("{") || trimmedDetail.startsWith("[")) return null;

    // Dynamic/MCP tool calls surface their arguments as `ToolName: {json}` —
    // transport detail, not a human summary. The raw call stays in toolDetails.
    // Failed calls keep their detail inline: it may carry the error text (e.g.
    // an MCP error serialized as `McpError: {json}`), and on a failure more
    // information beats a tidy row.
    if (toolWorkEntryStatus(workEntry) !== "failed" && isPrefixedToolArgumentSummary(trimmedDetail))
      return null;

    const readLinesMatch = /^Read\s+(\d+\s+lines?)$/i.exec(trimmedDetail);
    if (readLinesMatch?.[1]) return readLinesMatch[1];

    // Clean, non-JSON detail — show it
    return trimmedDetail;
  }

  return null;
}

// Provider read tools (e.g. Claude's `Read`) arrive as generic dynamic tool calls
// without a `file-read` requestKind, so match their tool name to surface the search icon
// instead of the generic tool/wrench fallback.
function isFileReadToolEntry(workEntry: TimelineWorkEntry): boolean {
  const name = (workEntry.toolName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return name === "read" || name === "readfile" || name === "viewfile";
}

// Command rows reuse toolCallLabel's wrapper-aware classifier so wrapped git/gh
// commands get the GitHub mark while ordinary commands keep the terminal icon.
function commandWorkEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  const command = workEntry.command ?? workEntry.rawCommand;
  switch (command ? resolveCommandVisualKind(command) : "terminal") {
    case "inspect":
      return ToolSearchIcon;
    case "git":
    case "github":
      return GitHubIcon;
    case "terminal":
      return ToolCommandIcon;
  }
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  // User-input rows read as a question (awaiting an answer) and an upload
  // (answer submitted) rather than the generic "info" checkmark.
  if (workEntry.activityKind === "user-input.requested") return CircleQuestionIcon;
  if (workEntry.activityKind === "user-input.resolved") return ArrowUpCircleIcon;
  // "Moved to background" notices read as a tray drop, not a warning check.
  if (workEntry.nativeEventType === "background_tasks_changed") return BackgroundTrayIcon;

  if (workEntry.requestKind === "command") return commandWorkEntryIcon(workEntry);
  if (workEntry.requestKind === "file-read") return ToolReadIcon;
  if (workEntry.requestKind === "file-change") return ToolEditIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return commandWorkEntryIcon(workEntry);
  }
  if (workEntry.itemType === "file_change") {
    return ToolEditIcon;
  }
  if (workEntry.itemType === "web_search") return ToolWebIcon;
  if (workEntry.itemType === "image_generation" || workEntry.itemType === "image_view") {
    return ToolImagesIcon;
  }
  if (isFileReadToolEntry(workEntry)) return ToolReadIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return ToolWrenchIcon;
    case "dynamic_tool_call":
      return ToolWrenchIcon;
    case "collab_agent_tool_call":
      return AgentTaskIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

// Dynamic icon selection is data, not a component declaration. Keeping the
// createElement call in this module helper avoids presenting a render-local
// component binding to React Compiler.
export function renderWorkEntryIcon(Icon: LucideIcon, className: string): ReactElement {
  return createElement(Icon, { className });
}

// The leading glyph for a tool row: recognizable product and surface icons win
// over the kind-derived entry icon. Shared with the collapsed tool-group summary
// row, which borrows its first entry's icon.
export function workEntryLeftIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (isGitHubMcpToolCall(workEntry)) return GitHubIcon;
  if (isVeylenBrowserWorkEntry(workEntry)) return GlobeIcon;
  if (isVeylenToolCall(workEntry)) return VeylenToolIcon;
  if (workEntry.itemType === "mcp_tool_call") return McpIcon;
  return workEntryIcon(workEntry);
}

function isGitHubMcpToolCall(workEntry: TimelineWorkEntry): boolean {
  const toolName = workEntry.toolName?.trim().toLowerCase();
  return Boolean(toolName?.startsWith("mcp__codex_apps__github"));
}

// Veylen's own agent-gateway tools (veylen_list_threads, veylen_create_thread,
// ...) get the Veylen mark instead of the generic MCP glyph. Providers report
// the call differently: Claude prefixes the MCP server (mcp__veylen__*), ACP
// agents surface the bare tool name (veylen_*), and Codex reports server/tool
// pairs that the label humanizer renders as "Veylen: ...".
function toolWorkEntryStatus(workEntry: TimelineWorkEntry): VeylenMcpToolStatus {
  if (workEntry.toolStatus) return workEntry.toolStatus;
  return workEntry.activityKind !== undefined && workEntry.activityKind !== "tool.completed"
    ? "running"
    : "completed";
}

function isVeylenBrowserWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return isVeylenBrowserToolCall({
    toolName: workEntry.toolName,
    title: workEntry.toolTitle,
    fallbackLabel: workEntry.label,
    status: toolWorkEntryStatus(workEntry),
  });
}

function isVeylenToolCall(workEntry: TimelineWorkEntry): boolean {
  return (
    deriveVeylenMcpToolTitle({
      toolName: workEntry.toolName,
      title: workEntry.toolTitle,
      fallbackLabel: workEntry.label,
      status: toolWorkEntryStatus(workEntry),
    }) !== null
  );
}

// Render command, agent-task, file-change, and file-read rows at the tighter
// compact density so every tool-call line shares one height regardless of whether
// it carries a disclosure chevron.
export function prefersCompactWorkEntryRow(workEntry: TimelineWorkEntry): boolean {
  if (isCodexActivityStatusWorkEntry(workEntry)) {
    return true;
  }
  // Commands stay compact even when surfaced with a non-terminal icon (read-only
  // inspections like `cat` now use the file-read search icon).
  if (workEntry.itemType === "command_execution" || workEntry.command || workEntry.rawCommand) {
    return true;
  }
  const EntryIcon = workEntryIcon(workEntry);
  return (
    EntryIcon === ToolCommandIcon ||
    EntryIcon === ToolWrenchIcon ||
    EntryIcon === AgentTaskIcon ||
    EntryIcon === ToolEditIcon ||
    // File-read / inspect rows (e.g. `Read …`) surface the search icon and have no
    // disclosure chevron; keep them at the same compact height as command rows.
    EntryIcon === ToolReadIcon ||
    EntryIcon === ToolSearchIcon
  );
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  const veylenTitle = deriveVeylenMcpToolTitle({
    toolName: workEntry.toolName,
    title: workEntry.toolTitle,
    fallbackLabel: workEntry.label,
    status: toolWorkEntryStatus(workEntry),
  });
  if (veylenTitle) {
    return veylenTitle;
  }
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

function combineWorkEntryDisplayText(heading: string, preview: string | null): string {
  if (!preview) {
    return heading;
  }
  return normalizeToolTextForComparison(heading) === normalizeToolTextForComparison(preview)
    ? heading
    : `${heading} ${preview}`;
}

function isFileChangeWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return isFileChangeWorkLogEntry(workEntry);
}

function commandTooltipContent(command: string, displayText: string) {
  return (
    <div className="max-w-96 whitespace-pre-wrap leading-tight">
      <div className="space-y-2">
        <div className="space-y-0.5">
          <div className="text-muted-foreground/70">Summary</div>
          <div>{displayText}</div>
        </div>
        <div className="space-y-0.5">
          <div className="text-muted-foreground/70">Raw call</div>
          <code className="block whitespace-pre-wrap break-words font-chat-code text-[11px] text-foreground/92">
            {command}
          </code>
        </div>
      </div>
    </div>
  );
}

// Hover content for a tool-call row: the rich command card when a raw command is
// present, otherwise the plain label (used to reveal truncated text / file paths).
// Returns null when there's nothing worth showing so the row renders untouched.
function toolRowTooltipContent(
  rawCommand: string | null | undefined,
  displayText: string,
  fallback: string | undefined,
): ReactNode {
  if (rawCommand) {
    return commandTooltipContent(rawCommand, displayText);
  }
  return fallback ? <span className="whitespace-pre-wrap">{fallback}</span> : null;
}

// Frosted hover tooltip for tool-call rows — the same surface (via the `default`
// variant) as the sidebar thread/project hover cards, so the rows read as one
// system. Replaces the native `title` tooltip; renders the trigger untouched when
// there's no content to show.
function ToolRowTooltip(props: { content: ReactNode; children: ReactElement }) {
  if (!props.content) {
    return props.children;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={props.children} />
      <TooltipPopup side="top" align="start" className="max-w-96 whitespace-normal">
        {props.content}
      </TooltipPopup>
    </Tooltip>
  );
}

export const TimelineWorkEntryRow = memo(function TimelineWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  chatMetaFontSizePx: number;
  textFontSizePx?: number;
  density?: "default" | "compact";
  presentation?: "default" | "summary-detail";
  fileDiffStatByPath?: ReadonlyMap<string, { additions: number; deletions: number }>;
  markdownCwd: string | undefined;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  turnId?: TurnId;
  onOpenTurnDiff?: (turnId: TurnId, filePath?: string) => void;
  onOpenAgentActivity?: (activityId: string) => void;
  onOpenAutomation?: (automationId: string) => void;
  onOpenThread?: (threadId: ThreadId) => void;
  timestampFormat: TimestampFormat;
}) {
  // Defaults are applied in the body (not in the destructuring pattern): a default
  // value inside a destructuring pattern makes React Compiler bail out on the whole
  // component, silently dropping memoization for every tool-call row.
  const {
    workEntry,
    chatMetaFontSizePx,
    textFontSizePx: textFontSizePxProp,
    density: densityProp,
    presentation: presentationProp,
    fileDiffStatByPath,
    markdownCwd,
    onImageExpand,
    turnId,
    onOpenTurnDiff,
    onOpenAgentActivity,
    onOpenAutomation,
    onOpenThread,
    timestampFormat,
  } = props;
  const textFontSizePx = textFontSizePxProp ?? chatMetaFontSizePx;
  const density = densityProp ?? "default";
  const compact = density === "compact";
  const summaryDetail = presentationProp === "summary-detail";
  const isCodexStatusRow = isCodexActivityStatusWorkEntry(workEntry);
  const EntryIcon = workEntryIcon(workEntry);
  // Web-fetch tool calls surface the target site (favicon + URL) instead of the raw
  // `WebFetch: {json}` arguments, reusing the same link-chip icon/label path as
  // composer and markdown links so every site reference looks identical.
  const webFetchUrl = extractWebFetchUrl(workEntry);
  // Standard tool rows keep one discoverable left glyph. Codex status rows
  // deliberately skip it and reuse only the shared tool-label typography.
  const isGitHubToolRow = isGitHubMcpToolCall(workEntry);
  const isVeylenBrowserToolRow = !isGitHubToolRow && isVeylenBrowserWorkEntry(workEntry);
  const isVeylenToolRow =
    !isGitHubToolRow && !isVeylenBrowserToolRow && isVeylenToolCall(workEntry);
  const isMcpToolRow =
    workEntry.itemType === "mcp_tool_call" &&
    !isGitHubToolRow &&
    !isVeylenBrowserToolRow &&
    !isVeylenToolRow;
  const LeftIcon = workEntryLeftIcon(workEntry);
  const leftIconKind = webFetchUrl
    ? "web-fetch"
    : isGitHubToolRow || EntryIcon === GitHubIcon
      ? "github"
      : isVeylenBrowserToolRow
        ? "browser"
        : isVeylenToolRow
          ? "veylen"
          : isMcpToolRow
            ? "mcp"
            : undefined;
  const heading = toolWorkEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry);
  const preview =
    isVeylenBrowserToolRow || isVeylenToolRow
      ? sanitizeVeylenMcpToolPreview({
          preview: rawPreview,
          heading,
          status: toolWorkEntryStatus(workEntry),
        })
      : rawPreview;
  // One sentence per row, live or settled: the tool's own verb plus what it acted
  // on ("Searched for foo in src"). Lifecycle state is never spelled out here —
  // the verb already carries the tense and `liveActivityMetaText` covers the rest.
  const defaultDisplayText = webFetchUrl
    ? describeLinkChip(webFetchUrl).label
    : isReasoningUpdateWorkEntry(workEntry) && preview
      ? preview
      : combineWorkEntryDisplayText(heading, preview);
  const showInlineAgentTaskPreview =
    workEntry.itemType === "collab_agent_tool_call" &&
    Boolean(preview) &&
    normalizeToolTextForComparison(heading) !== normalizeToolTextForComparison(preview ?? "");
  const rawCommand = workEntry.rawCommand ?? workEntry.command;
  const displayText =
    summaryDetail && isSummarizableToolCallEntry(workEntry)
      ? formatToolCallDetailLabel(workEntry)
      : workEntry.liveActivity && isLiveActivityInProgress(workEntry.liveActivity)
        ? formatLiveActivityPrimary({
            activity: workEntry.liveActivity,
            entry: workEntry,
            heading,
            displayTarget: showInlineAgentTaskPreview ? heading : defaultDisplayText,
            rawCommand,
          })
        : defaultDisplayText;
  const hoverText =
    rawCommand ?? (showInlineAgentTaskPreview ? heading : (webFetchUrl ?? displayText));
  const changedFiles = workEntry.changedFiles ?? [];
  const showEditedRows = isFileChangeWorkEntry(workEntry) && changedFiles.length > 0;
  const canOpenAgentActivity = Boolean(onOpenAgentActivity) && isAgentActivityWorkEntry(workEntry);
  const openAgentActivity = canOpenAgentActivity
    ? () => onOpenAgentActivity?.(workEntry.id)
    : undefined;
  const hasToolDetails = Boolean(workEntry.toolDetails);
  const userInputInteraction = workEntry.userInputInteraction;
  // File-read rows open the referenced file in the in-app viewer when the
  // hosting surface provides an opener (right-dock file pane / editor pane).
  const opener = useWorkspaceFileOpener();
  // Per-file +N/-M parsed from this tool call's own patch, used as a fallback when
  // the turn-diff summary isn't in scope (e.g. standalone work rows) so every
  // "Edited <file>" row can still show diff stats.
  const toolDiffStatsByPath = useMemo(
    () =>
      isFileChangeWorkEntry(workEntry)
        ? fileDiffStatsByPath(workEntry.toolDetails?.diff)
        : EMPTY_FILE_DIFF_STATS,
    [workEntry],
  );
  const liveActivityNowMs = useLiveActivityNow(workEntry.liveActivity);
  const liveActivityMetaText =
    !summaryDetail && workEntry.liveActivity
      ? formatLiveActivityMeta(workEntry.liveActivity, liveActivityNowMs)
      : null;

  // A created-automation row renders as its own card instead of a tool-call line.
  // Kept after the hooks above so the early return never changes hook order.
  const automation = workEntry.automation;
  if (automation) {
    return (
      <div className={cn(compact ? "py-0.5" : "py-1")}>
        <AutomationCreatedCard
          automationId={automation.id}
          name={automation.name}
          cadenceLabel={automation.cadenceLabel}
          {...(automation.proposalState ? { proposalState: automation.proposalState } : {})}
          textFontSizePx={textFontSizePx}
          metaFontSizePx={chatMetaFontSizePx}
          {...(onOpenAutomation ? { onOpen: () => onOpenAutomation(automation.id) } : {})}
        />
      </div>
    );
  }

  // Agent-invoked Advisor (type 3): live strip → quiet expandable receipt.
  if (isAdvisorConsultationWorkEntry(workEntry)) {
    return (
      <AdvisorConsultationWorkRow
        workEntry={workEntry}
        fontSizePx={textFontSizePx}
        {...(onOpenThread ? { onOpenThread } : {})}
      />
    );
  }

  const readFilePath =
    opener !== null &&
    !canOpenAgentActivity &&
    workEntry.detail &&
    (workEntry.requestKind === "file-read" || isFileReadToolEntry(workEntry))
      ? extractFilePathFromDetail(workEntry.detail)
      : null;
  const canOpenReadFile = readFilePath !== null;
  const canOpenEntryDetails =
    !summaryDetail &&
    !canOpenAgentActivity &&
    Boolean(
      userInputInteraction || workEntry.toolDetails || (workEntry.liveActivity && !canOpenReadFile),
    );
  const openReadFile = readFilePath
    ? () => openWorkspaceFileReference(opener, readFilePath)
    : undefined;
  const prefetchReadFile =
    readFilePath && opener?.prefetchFile ? () => opener.prefetchFile?.(readFilePath) : undefined;

  // Use the text font size (matching the UI settings) for tool call rows
  const rowFontSizePx = textFontSizePx;

  return (
    <div data-work-entry-row="true" className={cn(compact ? "py-0.5" : "rounded-lg py-1")}>
      {showEditedRows ? (
        <div className="space-y-0.5">
          {changedFiles.map((changedFilePath) => {
            // Prefer the turn-diff summary's per-file stat; fall back to the stat
            // parsed from this tool call's own patch so the +N/-M shows even when
            // no summary is in scope (standalone work rows) or it lacks the file.
            const summaryStat = fileDiffStatByPath?.get(changedFilePath);
            const changedFileStat =
              summaryStat && summaryStat.additions + summaryStat.deletions > 0
                ? summaryStat
                : (resolveFileDiffStatByChangedPath(
                    toolDiffStatsByPath,
                    changedFilePath,
                    changedFiles.length,
                  ) ?? summaryStat);
            const canOpenEditedDiff = Boolean(turnId && onOpenTurnDiff);
            const canOpenEditedRow = canOpenEntryDetails || canOpenEditedDiff;
            const editedRowClassName = cn(
              "group/file-row flex w-full max-w-full items-center text-left transition-colors duration-150",
              compact ? "gap-1.5" : "gap-2",
              canOpenEditedRow ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
            );
            const editedRowChildren = (
              <EditedFileRowContent
                filePath={changedFilePath}
                additions={changedFileStat?.additions}
                deletions={changedFileStat?.deletions}
                fontSizePx={rowFontSizePx}
                compact={compact}
              />
            );
            if (!summaryDetail && (hasToolDetails || (canOpenEntryDetails && !canOpenEditedDiff))) {
              return (
                <WorkEntryDetailsDisclosure
                  key={`${workEntry.id}:${changedFilePath}`}
                  details={workEntry.toolDetails}
                  activity={workEntry.liveActivity}
                  compact={compact}
                  tooltip={<span className="whitespace-pre-wrap">{changedFilePath}</span>}
                  summaryClassName={editedRowClassName}
                  dataFileChangeRow
                  timestampFormat={timestampFormat}
                >
                  {editedRowChildren}
                </WorkEntryDetailsDisclosure>
              );
            }
            return (
              <button
                key={`${workEntry.id}:${changedFilePath}`}
                type="button"
                data-file-change-row="true"
                className={editedRowClassName}
                title={changedFilePath}
                disabled={!canOpenEditedRow}
                onClick={() => {
                  if (!turnId || !onOpenTurnDiff) {
                    return;
                  }
                  onOpenTurnDiff(turnId, changedFilePath);
                }}
              >
                {editedRowChildren}
              </button>
            );
          })}
        </div>
      ) : (
        (() => {
          const rowContentChildren = (
            <>
              {!isCodexStatusRow ? (
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center",
                    WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    compact ? "size-4" : "size-5",
                  )}
                  data-tool-icon={leftIconKind}
                  data-work-entry-icon="true"
                >
                  {webFetchUrl ? (
                    <LinkChipIcon url={webFetchUrl} className={compact ? "size-3.5" : "size-4"} />
                  ) : (
                    renderWorkEntryIcon(LeftIcon, compact ? "size-3.5" : "size-4")
                  )}
                </span>
              ) : null}
              <div
                className={cn(
                  "min-w-0 overflow-hidden",
                  // Single-line tool labels size to their content so the disclosure
                  // chevron can sit right after the name; the multi-line markdown
                  // preview still needs the full row width.
                  showInlineAgentTaskPreview && "flex-1",
                )}
              >
                {showInlineAgentTaskPreview ? (
                  <div className={cn(compact ? "space-y-[1px]" : "space-y-0.5")}>
                    <p
                      className="truncate font-medium leading-5 text-muted-foreground/72"
                      style={{ fontSize: `${rowFontSizePx}px` }}
                    >
                      <span data-work-entry-display-text="true">{heading}</span>
                      {liveActivityMetaText ? (
                        <span data-live-activity-meta="true"> · {liveActivityMetaText}</span>
                      ) : null}
                    </p>
                    <ChatMarkdown
                      text={preview ?? ""}
                      cwd={markdownCwd}
                      isStreaming={false}
                      className="leading-relaxed"
                      style={{
                        color: "color-mix(in srgb, var(--muted-foreground) 72%, transparent)",
                        fontSize: `${Math.max(11, rowFontSizePx - 1)}px`,
                        lineHeight: compact ? "18px" : "19px",
                      }}
                      onImageExpand={onImageExpand}
                    />
                  </div>
                ) : (
                  <p
                    className={cn(
                      compact ? "truncate leading-5" : "truncate leading-6",
                      // Match the leading icon's tone so the row reads as one muted unit, and
                      // brighten the whole row to foreground on hover/focus instead of a fill.
                      WORK_ROW_MUTED_HOVER_TONE["tool-row"],
                    )}
                    data-codex-status-row={isCodexStatusRow ? "true" : undefined}
                    style={{ fontSize: `${rowFontSizePx}px` }}
                  >
                    <span data-work-entry-display-text="true">{displayText}</span>
                    {liveActivityMetaText ? (
                      <span data-live-activity-meta="true"> · {liveActivityMetaText}</span>
                    ) : null}
                  </p>
                )}
              </div>
            </>
          );
          if (canOpenEntryDetails) {
            return (
              <WorkEntryDetailsDisclosure
                details={workEntry.toolDetails}
                activity={workEntry.liveActivity}
                detailKind={userInputInteraction ? "user-input" : "tool"}
                detailsContent={
                  userInputInteraction ? (
                    <UserInputInteractionDetails interaction={userInputInteraction} />
                  ) : undefined
                }
                compact={compact}
                timestampFormat={timestampFormat}
                tooltip={toolRowTooltipContent(rawCommand, displayText, displayText)}
              >
                {rowContentChildren}
              </WorkEntryDetailsDisclosure>
            );
          }

          const rowContent = (
            <AgentActivityOpenSurface
              canOpen={canOpenAgentActivity || canOpenReadFile}
              compact={compact}
              onOpen={openAgentActivity ?? openReadFile}
              onHover={prefetchReadFile}
              tooltip={toolRowTooltipContent(
                summaryDetail ? undefined : rawCommand,
                displayText,
                summaryDetail
                  ? undefined
                  : canOpenReadFile
                    ? (readFilePath ?? hoverText)
                    : hoverText,
              )}
            >
              {rowContentChildren}
            </AgentActivityOpenSurface>
          );

          return rowContent;
        })()
      )}
    </div>
  );
});

// Inner content for an "Edited <file> +n/-m" row. Mirrors the tool-call row treatment
// (muted leading icon + label that brightens to foreground on hover/focus, same font
// size) so edited rows read as the same visual unit. Callers own the interactive wrapper
// (`group/file-row` button or disclosure summary) and pass the diff stat when available.
export function EditedFileRowContent(props: {
  filePath: string;
  additions: number | undefined;
  deletions: number | undefined;
  fontSizePx: number;
  compact: boolean;
}) {
  const { filePath, additions, deletions, fontSizePx, compact } = props;
  const hasStat = (additions ?? 0) + (deletions ?? 0) > 0;
  return (
    <>
      <span
        className={cn(
          "flex shrink-0 items-center justify-center",
          WORK_ROW_MUTED_HOVER_TONE["file-row"],
          compact ? "size-4" : "size-5",
        )}
        data-tool-icon="edit"
      >
        <PencilIcon className={compact ? "size-3.5" : "size-4"} />
      </span>
      <span
        className={cn("font-system-ui shrink-0", WORK_ROW_MUTED_HOVER_TONE["file-row"])}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        Edited
      </span>
      <span
        className={cn(
          "font-system-ui max-w-[28rem] truncate underline-offset-2",
          WORK_ROW_MUTED_HOVER_TONE["file-row"],
          // Filename doubles as a link affordance: underline on the same row hover/focus.
          "group-hover/file-row:underline group-focus-visible/file-row:underline",
        )}
        style={{ fontSize: `${fontSizePx}px` }}
      >
        {basenameOfPath(filePath)}
      </span>
      {hasStat ? (
        <span
          className="font-system-ui shrink-0 tabular-nums whitespace-nowrap"
          style={{ fontSize: `${fontSizePx}px` }}
        >
          <DiffStatLabel additions={additions ?? 0} deletions={deletions ?? 0} />
        </span>
      ) : null}
    </>
  );
}

function AgentActivityOpenSurface(props: {
  canOpen: boolean;
  children: ReactNode;
  compact: boolean;
  /** Warm-up hook fired on hover/focus so opening feels instant. */
  onHover?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  title?: string | undefined;
  /** Styled frosted hover tooltip (preferred over the native `title`). */
  tooltip?: ReactNode;
  dataToolDetailTrigger?: boolean | undefined;
}) {
  const className = cn(
    "group/tool-row flex w-full items-center text-left transition-[opacity,translate] duration-200",
    props.compact ? "gap-1.5" : "gap-2",
    props.canOpen ? "cursor-pointer focus-visible:outline-none" : "cursor-default",
  );

  // Wrap the real DOM element (not this component) so Base UI's tooltip trigger
  // can attach its hover handlers and compose with our own onClick/onPointerEnter.
  const surface = props.canOpen ? (
    <button
      type="button"
      className={className}
      title={props.title}
      onClick={props.onOpen}
      data-tool-detail-trigger={props.dataToolDetailTrigger ? "true" : undefined}
      {...(props.onHover ? { onPointerEnter: props.onHover, onFocus: props.onHover } : {})}
    >
      {props.children}
    </button>
  ) : (
    <div className={className} title={props.title}>
      {props.children}
    </div>
  );

  return <ToolRowTooltip content={props.tooltip}>{surface}</ToolRowTooltip>;
}

function UserInputInteractionDetails(props: {
  interaction: NonNullable<TimelineWorkEntry["userInputInteraction"]>;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5">
      {props.interaction.questions.map((question, index) => {
        const rawAnswer = props.interaction.answers?.[question.id];
        const answers = Array.isArray(rawAnswer)
          ? rawAnswer.filter((answer) => answer.length > 0)
          : typeof rawAnswer === "string" && rawAnswer.length > 0
            ? [rawAnswer]
            : [];
        return (
          <section
            key={question.id}
            className={cn(index > 0 && "mt-3 border-t border-border/50 pt-3")}
          >
            <p className="text-xs font-medium text-muted-foreground">{question.header}</p>
            <p className="mt-1 text-sm leading-5 text-foreground">{question.question}</p>
            <div className="mt-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                {answers.length > 1 ? "Selected answers" : "Selected answer"}
              </p>
              {answers.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {answers.map((answer, answerIndex) => (
                    <span
                      key={`${answer}:${answerIndex}`}
                      className="rounded-md border border-border/60 bg-background/70 px-2 py-1 text-xs leading-4 text-foreground"
                    >
                      {answer}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Awaiting response</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function WorkEntryDetailsDisclosure(props: {
  children: ReactNode;
  compact: boolean;
  dataFileChangeRow?: boolean | undefined;
  detailKind?: "tool" | "user-input" | undefined;
  detailsContent?: ReactNode;
  details?: TimelineWorkEntry["toolDetails"] | undefined;
  activity?: TimelineWorkEntry["liveActivity"] | undefined;
  summaryClassName?: string | undefined;
  timestampFormat: TimestampFormat;
  tooltip?: ReactNode;
}) {
  const detailKind = props.detailKind ?? "tool";
  const summaryClassName =
    props.summaryClassName ??
    cn(
      "group/tool-row flex w-full items-center text-left transition-[opacity,translate] duration-200",
      props.compact ? "gap-1.5" : "gap-2",
      "cursor-pointer focus-visible:outline-none",
    );
  const [open, setOpen] = useState(false);
  const [renderDetails, setRenderDetails] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const openFrameRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);

  const clearMotionTimers = useCallback(() => {
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
    if (cleanupTimeoutRef.current !== null) {
      window.clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  const setDetailsOpen = useCallback(
    (nextOpen: boolean) => {
      clearMotionTimers();
      setOpen(nextOpen);

      if (nextOpen) {
        setRenderDetails(true);
        setMotionOpen(false);
        openFrameRef.current = window.requestAnimationFrame(() => {
          openFrameRef.current = null;
          setMotionOpen(true);
        });
        return;
      }

      setMotionOpen(false);
      cleanupTimeoutRef.current = window.setTimeout(() => {
        cleanupTimeoutRef.current = null;
        setRenderDetails(false);
      }, TRANSCRIPT_DISCLOSURE_TRANSITION_MS + TRANSCRIPT_DISCLOSURE_CLEANUP_BUFFER_MS);
    },
    [clearMotionTimers],
  );

  useEffect(() => () => clearMotionTimers(), [clearMotionTimers]);

  const summaryButton = (
    <button
      type="button"
      className={summaryClassName}
      aria-expanded={open}
      data-file-change-row={props.dataFileChangeRow ? "true" : undefined}
      data-work-entry-detail-trigger="true"
      data-tool-detail-trigger={detailKind === "tool" ? "true" : undefined}
      data-user-input-detail-trigger={detailKind === "user-input" ? "true" : undefined}
      onClick={() => {
        setDetailsOpen(!open);
      }}
    >
      {props.children}
      <DisclosureChevron
        open={open}
        className="text-muted-foreground/38 group-hover/tool-row:text-foreground group-hover/file-row:text-foreground group-focus-visible/tool-row:text-foreground group-focus-visible/file-row:text-foreground"
      />
    </button>
  );

  return (
    <div className="group/tool-details min-w-0">
      <ToolRowTooltip content={props.tooltip}>{summaryButton}</ToolRowTooltip>
      {renderDetails ? (
        <DisclosureRegion
          open={motionOpen}
          contentClassName={cn("min-w-0 pt-2", props.compact ? "ml-5" : "ml-7")}
        >
          <div
            data-work-entry-details-inline="true"
            data-tool-details-inline={detailKind === "tool" ? "true" : undefined}
            data-user-input-details-inline={detailKind === "user-input" ? "true" : undefined}
          >
            {props.detailsContent ?? (
              <ToolCallDetailsContent
                details={props.details}
                activity={props.activity}
                timestampFormat={props.timestampFormat}
              />
            )}
          </div>
        </DisclosureRegion>
      ) : null}
    </div>
  );
}
