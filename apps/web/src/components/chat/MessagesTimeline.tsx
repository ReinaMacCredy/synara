// FILE: MessagesTimeline.tsx
// Purpose: Renders the chat transcript rows and lets LegendList own scrolling/follow behavior.
// Layer: Web chat presentation component
// Exports: MessagesTimeline

import {
  type MessageId,
  type ProviderMentionReference,
  ThreadId,
  type ThreadMarker,
  type TurnId,
} from "@veylen/contracts";
import { pluralize } from "@veylen/shared/text";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  deriveTimelineEntries,
  formatClockElapsed,
  isFileChangeWorkLogEntry,
  type WorkLogEntry,
} from "../../session-logic";
import {
  type TurnDiffSummary,
  type WorktreeSetupSnapshot,
  type WorktreeSetupStep,
} from "../../types";
import ChatMarkdown from "../ChatMarkdown";
import { InlineLinkChip } from "../InlineLinkChip";
import {
  BotIcon,
  ChangesIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClockIcon,
  LoaderIcon,
  type LucideIcon,
  NewThreadIcon,
  PinIcon,
  SteerIcon,
  Undo2Icon,
  WorktreeIcon,
} from "~/lib/icons";
import { pinActionLabel } from "~/lib/pin";
import { Button } from "../ui/button";
import { CrossTaskOriginLabel, type CrossTaskOrigin } from "./CrossTaskOriginLabel";
import { ForkSourceDivider, type ForkSourceReference } from "./ForkSourceDivider";
import { VeylenThreadCreationCard } from "./VeylenThreadCreationCard";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { DiffStatLabel } from "./DiffStatLabel";
import { ReviewChangesButton } from "./ReviewChangesButton";
import { FileEntryIcon } from "./FileEntryIcon";
import { InlineMentionChip } from "./InlineMentionChip";
import { InlineSkillChip } from "./InlineSkillChip";
import { InlineAgentChip } from "./InlineAgentChip";
import { MessageActionButton, MESSAGE_ACTION_ICON_CLASS_NAME } from "./MessageActionButton";
import { MessageCopyButton } from "./MessageCopyButton";
import { MessageForkButton, type MessageForkTarget } from "./MessageForkButton";
import { ForkContinuationDivider } from "./ForkContinuationDivider";
import { ReasoningTextSwap } from "./ReasoningTextSwap";
import { CadencedShimmer } from "./CadencedShimmer";
import { formatAgentActivityEntryPreview } from "./agentActivity.logic";
import { AssistantSelectionsSummaryChip } from "./AssistantSelectionsSummaryChip";
import { FileAttachmentChip } from "./FileAttachmentChip";
import { FileCommentsSummaryChip } from "./FileCommentsSummaryChip";
import { BrowserAnnotationStrip } from "./BrowserAnnotationStrip";
import { UserMessagePastedTextCard } from "./PastedTextChip";
import {
  EditedFileRowContent,
  prefersCompactWorkEntryRow,
  TimelineWorkEntryRow,
} from "./TimelineWorkEntryRow";
import {
  hasLeadingUserMedia,
  resolveUserTurnMarker,
  type UserTurnMarkerKind,
} from "./userTurnMarker";
import {
  canSubmitUserMessageEdit,
  capOpenWorkEntryRenderChunks,
  chunkCollapsedTurnItems,
  computeStableMessagesTimelineRows,
  deriveMessagesTimelineRows,
  findLastLiveWorkGroupId,
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  planWorkEntryRenderChunks,
  type CollapsedTurnChunk,
  type CollapsedTurnItem,
  type MessagesTimelineRow,
  resolveAssistantMessageCopyState,
  resolveAssistantMessageDisplayText,
  type StableMessagesTimelineRowsState,
} from "./MessagesTimeline.logic";
import { isSummarizableToolCallEntry, summarizeToolCallGroup } from "./toolCallGroup.logic";
import { ToolCallGroupSummaryRow } from "./ToolCallGroupSummaryRow";
import { useTailAnchorScroll } from "./useTailAnchorScroll";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import {
  DEFAULT_CHAT_FONT_SIZE_PX,
  normalizeChatFontSizePx,
  type TimestampFormat,
} from "../../appSettings";
import {
  CHAT_COLUMN_FRAME_CLASS_NAME,
  CHAT_COLUMN_GUTTER_CLASS_NAME,
  ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
} from "./composerPickerStyles";
import { formatShortTimestamp } from "../../timestampFormat";
import {
  buildInlineTerminalContextText,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { splitPromptIntoDisplaySegments } from "~/composer-editor-mentions";
import {
  getChatMessageFooterTextStyle,
  getChatTranscriptTextStyle,
  getChatTranscriptUserMessageLineHeightPx,
  getChatTranscriptUserMessageTextStyle,
  USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
  USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
  userMessageBubbleBorderClassName,
} from "./chatTypography";
import { DisclosureChevron } from "../ui/DisclosureChevron";
import { DisclosureRegion } from "../ui/DisclosureRegion";
import {
  DISCLOSURE_CLEANUP_BUFFER_MS,
  DISCLOSURE_CONTENT_CLOSED_CLASS,
  DISCLOSURE_CONTENT_MOTION_CLASS,
  DISCLOSURE_CONTENT_OPEN_CLASS,
  DISCLOSURE_INNER_CLASS,
  DISCLOSURE_SHELL_CLOSED_CLASS,
  DISCLOSURE_SHELL_MOTION_CLASS,
  DISCLOSURE_SHELL_OPEN_CLASS,
  DISCLOSURE_TRANSITION_MS,
} from "~/lib/disclosureMotion";
import { getAppTypographyScale } from "../../lib/appTypography";
import {
  USER_MESSAGE_COLLAPSED_FADE_LINES,
  USER_MESSAGE_COLLAPSED_MAX_LINES,
  userMessageLikelyOverflows,
} from "./userMessageCollapse";
import { observeUserMessageOverflow } from "./userMessageOverflowObserver";
import {
  resolveActiveTrailSnapshot,
  type ActiveTrailSnapshot,
  type MessageTrailAnchor,
} from "./messageTrail.logic";

const MAX_VISIBLE_INLINE_TOOL_ENTRIES = 4;
// Changed-files list in the per-turn card is capped so large turns stay compact;
// the rest are revealed via an inline "Show more" row.
const MAX_VISIBLE_CHANGED_FILES = 5;
// The composer overlaps the transcript by design, so the list needs extra tail
// space beyond the overlap to keep final cards from sitting flush against it.
const BOTTOM_CONTENT_INSET_PX = 64;
// How long a jumped-to message keeps its highlight tint before fading back out.
const JUMP_HIGHLIGHT_DURATION_MS = 1200;
const MARKER_FINE_SCROLL_RETRY_TIMEOUT_MS = 900;
const MARKER_FINE_SCROLL_MAX_RETRY_FRAMES = 90;
const MESSAGE_SEND_ENTER_ANIMATION_MS = 180;
const MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS = 60;
// Treat any partially visible row (>= 1px) as in view, so the navigation trail's
// "active" tick tracks the topmost rendered row rather than waiting for a turn to
// be substantially on-screen.
const TRAIL_VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 0 } as const;
// The deep-link "active" ring is applied imperatively to the rendered marker spans so jumping
// never re-parses a message's markdown tree (the className is purely a CSS box-shadow).
const ACTIVE_MARKER_CLASS_NAME = "thread-marker-active";
const EMPTY_MESSAGE_MARKERS: readonly ThreadMarker[] = [];
const EMPTY_THREAD_MARKERS_BY_MESSAGE_ID = new Map<MessageId, readonly ThreadMarker[]>();
const EMPTY_MESSAGE_ID_SET: ReadonlySet<MessageId> = new Set();

// Imperative LegendList access goes through these module-level helpers instead of
// inline `ref.current` reads. The timeline's list ref is `listRef ?? fallbackListRef`,
// which React Compiler cannot recognize as a ref, so an inline `.current` read makes it
// infer a `ref.current` dependency that no manual dep array can declare — and the whole
// component bails out with "Existing memoization could not be preserved". Behind an
// opaque module-level call the inferred dependency is the ref object itself, matching the
// hand-written dep arrays. See MessagesTimeline.compiler.test.ts.
function scrollLegendListToEnd(listRef: RefObject<LegendListRef | null>): void {
  void listRef.current?.scrollToEnd?.({ animated: false });
}

function scrollLegendListToIndex(
  listRef: RefObject<LegendListRef | null>,
  params: Parameters<LegendListRef["scrollToIndex"]>[0],
): void {
  void listRef.current?.scrollToIndex(params);
}

function readLegendListState(
  listRef: RefObject<LegendListRef | null>,
): ReturnType<NonNullable<LegendListRef["getState"]>> | undefined {
  return listRef.current?.getState?.();
}

/**
 * Imperative handle the transcript exposes so the Environment panel's pinned-message
 * checklist can scroll the virtualized list to (and briefly flash) a specific message.
 */
export interface MessagesTimelineController {
  scrollToMessage: (messageId: MessageId) => void;
  scrollToMarker: (marker: ThreadMarker) => void;
}

// Keeps the origin/steer marker visually attached to the whole sent-message stack.
// Which marker (if any) applies comes from the shared resolveUserTurnMarker predicate,
// which the timelineHeight estimator also uses — keep presentation-only concerns here.
const USER_TURN_MARKER_PRESENTATION: Record<
  UserTurnMarkerKind,
  { readonly Icon: LucideIcon; readonly label: string }
> = {
  automation: { Icon: ClockIcon, label: "Sent via Automation" },
  agent: { Icon: BotIcon, label: "Sent by agent" },
  steer: { Icon: SteerIcon, label: "Steering conversation" },
};

function UserDispatchModeChip({
  dispatchMode,
  dispatchOrigin,
  hasLeadingMedia,
}: {
  dispatchMode: TimelineMessage["dispatchMode"];
  dispatchOrigin: TimelineMessage["dispatchOrigin"];
  hasLeadingMedia: boolean;
}) {
  const markerKind = resolveUserTurnMarker({ dispatchMode, dispatchOrigin });
  if (!markerKind) {
    return null;
  }

  const { Icon, label } = USER_TURN_MARKER_PRESENTATION[markerKind];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 self-end px-0 text-[11px] font-normal tracking-[0.01em] text-muted-foreground/78",
        hasLeadingMedia ? "mb-3" : "mb-1.5",
      )}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground/75" />
      <span>{label}</span>
    </div>
  );
}

function cssAttributeSelectorValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getMonotonicTimeMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

// A marker can split into several spans when its range crosses markdown nodes, so collect every
// rendered span for the marker (used both to scroll into view and to decorate the active ring).
function collectThreadMarkerElements(
  root: ParentNode | null,
  marker: Pick<ThreadMarker, "id" | "messageId">,
): HTMLElement[] {
  if (!root) {
    return [];
  }
  const messageId = cssAttributeSelectorValue(marker.messageId);
  const markerId = cssAttributeSelectorValue(marker.id);
  const selector = `[data-assistant-message-id="${messageId}"] [data-thread-marker-id="${markerId}"]`;
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

function findVisibleThreadMarkerElement(elements: readonly HTMLElement[]): HTMLElement | null {
  for (const element of elements) {
    if (element.getClientRects().length > 0) {
      return element;
    }
  }
  return null;
}

// Per-step status glyph for the worktree setup stepper. Mirrors the active
// task-list card: spinner while active, check when done, hollow node pending.
function WorktreeSetupStepGlyph({ status }: { status: WorktreeSetupStep["status"] }) {
  if (status === "done") {
    // Foreground (black) check, same box as the spinner so done/active nodes match.
    return <CircleCheckIcon className="size-2.5 text-[var(--color-text-foreground)]" />;
  }
  if (status === "active") {
    // Spinner sized to match the pending nodes, in foreground (black) so the
    // active step reads as the current work rather than an accent flourish.
    return <LoaderIcon className="size-2.5 animate-spin text-[var(--color-text-foreground)]" />;
  }
  if (status === "error") {
    return <CircleAlertIcon className="size-2.5 text-destructive" />;
  }
  // Lucide circles render at ~83% of their box, so an 8px ring matches the
  // visible diameter of the size-2.5 spinner/check glyphs.
  return <span className="block size-2 rounded-full border border-[color:var(--color-border)]" />;
}

// Transient "Preparing worktree..." panel: a compact bordered card with a
// git-branch header and a connected stepper. Hugs its content so it reads as a
// status chip rather than a full-width block.
function WorktreeSetupCard({ steps }: { steps: ReadonlyArray<WorktreeSetupStep> }) {
  return (
    <div className="w-fit max-w-full rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-elevated-primary)] px-3.5 py-3 font-system-ui shadow-xs">
      <div className="flex items-center gap-2">
        <WorktreeIcon className="size-3.5 shrink-0 text-[var(--color-text-foreground-tertiary)]" />
        <CadencedShimmer className="text-[13px] font-medium text-[var(--color-text-foreground-secondary)]">
          Preparing worktree...
        </CadencedShimmer>
      </div>
      <ol className="mt-2 flex flex-col">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="relative flex items-center gap-2.5 py-[3px]">
              {isLast ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-[6.5px] top-1/2 h-full w-px",
                    step.status === "done"
                      ? "bg-[var(--color-text-foreground)]"
                      : "bg-[color:var(--color-border)]",
                  )}
                />
              )}
              <span className="relative z-10 flex size-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--color-background-elevated-primary)]">
                <WorktreeSetupStepGlyph status={step.status} />
              </span>
              <span
                className={cn(
                  "text-[13px] leading-5",
                  step.status === "active" || step.status === "done"
                    ? "text-[var(--color-text-foreground)]"
                    : step.status === "error"
                      ? "text-destructive"
                      : "text-[var(--color-text-foreground-tertiary)] opacity-70",
                )}
              >
                {step.label}
                {step.status === "error" ? " — failed" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface MessagesTimelineProps {
  hasMessages: boolean;
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnStartedAt: string | null;
  /** Transient "New worktree" setup progress; rendered as an ephemeral step card at the tail. */
  worktreeSetup?: WorktreeSetupSnapshot | null;
  followLiveOutput?: boolean;
  emptyStateContent?: ReactNode;
  footerContent?: ReactNode;
  listRef?: RefObject<LegendListRef | null>;
  /** Receives the scroll-to-message controller so the Environment panel can jump to a pin. */
  controllerRef?: RefObject<MessagesTimelineController | null>;
  /** Message ids currently pinned for the active thread (drives the footer pin toggle state). */
  pinnedMessageIds?: ReadonlySet<MessageId>;
  /** Excludes transient rows from persistent pin affordances. */
  canPinMessage?: (messageId: MessageId) => boolean;
  /** Toggle a message's pinned state from the assistant footer. */
  onTogglePinMessage?: (messageId: MessageId) => void;
  /**
   * Fork the active thread from the assistant footer (Local / Worktree menu).
   * Omit when the thread cannot be forked (e.g. local draft).
   */
  onForkThread?: (target: MessageForkTarget) => void | Promise<void>;
  /** Secondary line under “Fork into local” in the footer fork menu. */
  forkLocalDescription?: string;
  /**
   * When set, this thread is a user fork — show “Continued from chat” after the
   * last message that still belongs to the pre-fork history.
   */
  forkSourceThreadId?: ThreadId | null;
  /** Thread creation time; used with message timestamps to place the fork divider. */
  forkCreatedAt?: string | null;
  /** Text markers for assistant messages in the active thread. */
  threadMarkers?: readonly ThreadMarker[];
  /** User messages inserted locally by send actions, eligible for the subtle enter affordance. */
  enteringUserMessageIds?: ReadonlySet<MessageId>;
  /**
   * Just-sent user message to anchor at the top of the viewport for the live turn.
   * While set, the tail spacer reserves the space below it so the streaming response
   * fills the remaining viewport; null collapses the reserve (turn finished).
   */
  tailAnchorMessageId?: MessageId | null;
  /**
   * Shared flag set by ChatView on send and cleared by the tail-anchor hook once
   * the anchored slide settles; ChatView's auto-follow re-snaps pause while set.
   */
  tailAnchorScrollInFlightRef?: RefObject<boolean> | undefined;
  /** Provenance for a conversation created from another Veylen task. */
  crossTaskOrigin?: CrossTaskOrigin | null;
  /** Immediate source chat for a forked transcript. */
  forkSource?: ForkSourceReference | null;
  /** Marks the transcript as a temporary chat so user bubbles render the dashed primary outline. */
  isTemporaryThread?: boolean;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  nowIso?: string;
  expandedWorkGroups?: Record<string, boolean>;
  onToggleWorkGroup?: (groupId: string) => void;
  onOpenAgentActivity?: (activityId: string) => void;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onOpenThread?: (threadId: ThreadId) => void;
  /** Open an automation's detail page from a "created automation" transcript card. */
  onOpenAutomation?: (automationId: string) => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  onUndoTurnFiles?: (turnCounts: readonly number[]) => void;
  onEditUserMessage?: (messageId: MessageId, text: string) => boolean | Promise<boolean>;
  /**
   * The user message the edit affordance may target, resolved by the owner from
   * the raw thread messages (the same list the server-side edit policy
   * validates). The timeline must not re-derive this from its own rows: they are
   * createdAt-sorted and include optimistic/filtered entries, so a row-derived
   * target can point at a message the server rejects.
   */
  editableUserMessageId?: MessageId | null;
  activeTurnId?: TurnId | null;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onIsAtEndChange?: (isAtEnd: boolean) => void;
  /** Emits current + visible sent-message anchors as the viewport scrolls (drives the trail). */
  onTrailHighlightsChange?: (snapshot: ActiveTrailSnapshot) => void;
  onMessagesClickCapture?: ComponentProps<typeof LegendList>["onClickCapture"];
  onMessagesMouseUp?: ComponentProps<typeof LegendList>["onMouseUp"];
  onMessagesPointerCancel?: ComponentProps<typeof LegendList>["onPointerCancel"];
  onMessagesPointerDown?: ComponentProps<typeof LegendList>["onPointerDown"];
  onMessagesPointerUp?: ComponentProps<typeof LegendList>["onPointerUp"];
  onMessagesScroll?: ComponentProps<typeof LegendList>["onScroll"];
  onMessagesTouchEnd?: ComponentProps<typeof LegendList>["onTouchEnd"];
  onMessagesTouchMove?: ComponentProps<typeof LegendList>["onTouchMove"];
  onMessagesTouchStart?: ComponentProps<typeof LegendList>["onTouchStart"];
  onMessagesWheel?: ComponentProps<typeof LegendList>["onWheel"];
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  chatFontSizePx?: number;
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  /**
   * Right padding (px) applied to the scroll viewport so transcript rows clear a right-edge
   * overlay (e.g. the docked Environment card). The scrollbar stays pinned to the viewport's
   * far right; only the content is inset.
   */
  contentInsetRightPx?: number | undefined;
}

export const MessagesTimeline = memo(function MessagesTimeline({
  hasMessages,
  isWorking,
  activeTurnInProgress,
  activeTurnStartedAt,
  worktreeSetup: worktreeSetupProp,
  followLiveOutput: followLiveOutputProp,
  listRef,
  controllerRef,
  pinnedMessageIds,
  canPinMessage,
  onTogglePinMessage,
  onForkThread,
  forkLocalDescription: forkLocalDescriptionProp,
  forkSourceThreadId: forkSourceThreadIdProp,
  forkCreatedAt: forkCreatedAtProp,
  threadMarkers: threadMarkersProp,
  enteringUserMessageIds: enteringUserMessageIdsProp,
  tailAnchorMessageId: tailAnchorMessageIdProp,
  tailAnchorScrollInFlightRef,
  crossTaskOrigin: crossTaskOriginProp,
  forkSource: forkSourceProp,
  isTemporaryThread: isTemporaryThreadProp,
  timelineEntries,
  turnDiffSummaryByAssistantMessageId,
  nowIso,
  expandedWorkGroups,
  onToggleWorkGroup,
  onOpenAgentActivity,
  onOpenTurnDiff,
  onOpenThread,
  onOpenAutomation,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  onUndoTurnFiles,
  onEditUserMessage,
  editableUserMessageId,
  activeTurnId,
  isRevertingCheckpoint,
  onImageExpand,
  onIsAtEndChange,
  onTrailHighlightsChange,
  onMessagesClickCapture,
  onMessagesMouseUp,
  onMessagesPointerCancel,
  onMessagesPointerDown,
  onMessagesPointerUp,
  onMessagesScroll,
  onMessagesTouchEnd,
  onMessagesTouchMove,
  onMessagesTouchStart,
  onMessagesWheel,
  markdownCwd,
  resolvedTheme,
  chatFontSizePx: chatFontSizePxProp,
  timestampFormat,
  workspaceRoot,
  emptyStateContent,
  footerContent,
  contentInsetRightPx,
}: MessagesTimelineProps) {
  // Prop defaults are resolved in the body rather than in the destructuring pattern:
  // an `AssignmentPattern` in the parameter list makes React Compiler bail out on the
  // entire component (silently, since `panicThreshold` is unset), which would drop
  // memoization for the whole transcript. See MessagesTimeline.compiler.test.ts.
  const worktreeSetup = worktreeSetupProp ?? null;
  const followLiveOutput = followLiveOutputProp ?? false;
  const forkLocalDescription = forkLocalDescriptionProp ?? "Continue in the current local thread";
  const forkSourceThreadId = forkSourceThreadIdProp ?? null;
  const forkCreatedAt = forkCreatedAtProp ?? null;
  const threadMarkers = threadMarkersProp ?? EMPTY_MESSAGE_MARKERS;
  const enteringUserMessageIds = enteringUserMessageIdsProp ?? EMPTY_MESSAGE_ID_SET;
  const tailAnchorMessageId = tailAnchorMessageIdProp ?? null;
  const forkSource = forkSourceProp ?? null;
  const isTemporaryThread = isTemporaryThreadProp ?? false;
  const userMessageBubbleBorderClass = userMessageBubbleBorderClassName(isTemporaryThread);
  // The timeline remounts per thread (and when the agent-activity detail view
  // closes), but the anchor lives above it and survives those remounts. An
  // anchor that is already set at mount time therefore describes a slide that
  // has *already* played — re-entry must land at the anchored end directly
  // rather than replaying the glide from the top of the whole conversation.
  const [inheritedTailAnchorMessageId] = useState<MessageId | null>(
    () => tailAnchorMessageIdProp ?? null,
  );
  const hasInheritedTailAnchor =
    inheritedTailAnchorMessageId !== null && tailAnchorMessageId === inheritedTailAnchorMessageId;
  const [settledTailAnchorMessageId, setSettledTailAnchorMessageId] = useState<MessageId | null>(
    () => inheritedTailAnchorMessageId,
  );
  const [releasedTailAnchorMessageId, setReleasedTailAnchorMessageId] = useState<MessageId | null>(
    null,
  );
  const handleTailAnchorSlideFinished = useCallback((messageId: MessageId) => {
    setSettledTailAnchorMessageId((current) => (current === messageId ? current : messageId));
  }, []);
  const crossTaskOrigin = crossTaskOriginProp ?? null;
  const normalizedChatFontSizePx = normalizeChatFontSizePx(
    chatFontSizePxProp ?? DEFAULT_CHAT_FONT_SIZE_PX,
  );
  // Inset rows from the right (overriding the gutter's right padding) without moving the
  // scroll viewport, so the scrollbar stays pinned to the far right while content clears
  // any right-edge overlay. Kept stable so LegendList isn't re-rendered on unrelated updates.
  const listScrollStyle = useMemo(
    () => (contentInsetRightPx ? { paddingRight: contentInsetRightPx } : undefined),
    [contentInsetRightPx],
  );
  const appTypographyScale = useMemo(
    () => getAppTypographyScale(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const chatTypographyStyle = useMemo(
    () => getChatTranscriptTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const userMessageTypographyStyle = useMemo(
    () => getChatTranscriptUserMessageTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const chatMessageFooterStyle = useMemo(
    () => getChatMessageFooterTextStyle(normalizedChatFontSizePx),
    [normalizedChatFontSizePx],
  );
  const [localExpandedWorkGroups, setLocalExpandedWorkGroups] = useState<Record<string, boolean>>(
    {},
  );
  const expandedWorkGroupsState = expandedWorkGroups ?? localExpandedWorkGroups;
  const handleToggleWorkGroup = useCallback(
    (groupId: string) => {
      if (onToggleWorkGroup) {
        onToggleWorkGroup(groupId);
        return;
      }
      setLocalExpandedWorkGroups((current) => ({
        ...current,
        [groupId]: !(current[groupId] ?? false),
      }));
    },
    [onToggleWorkGroup],
  );
  const [expandedCollapsedWork, setExpandedCollapsedWork] = useState<Record<string, boolean>>({});
  const setCollapsedWorkExpanded = useCallback((messageId: string, open: boolean) => {
    setExpandedCollapsedWork((current) => ({
      ...current,
      [messageId]: open,
    }));
  }, []);
  // Manual open/closed overrides for the collapsed tool-group summary rows,
  // keyed per group. Deliberately separate from expandedWorkGroupsState, whose
  // meaning is "show rows past the live +N cap".
  const [toolGroupSummaryOverrides, setToolGroupSummaryOverrides] = useState<
    Record<string, boolean>
  >({});
  const setToolGroupSummaryOpen = useCallback((groupKey: string, open: boolean) => {
    setToolGroupSummaryOverrides((current) => ({
      ...current,
      [groupKey]: open,
    }));
  }, []);
  const [expandedFileChangesByTurnId, setExpandedFileChangesByTurnId] = useState<
    Record<string, boolean>
  >({});
  // Tracks which turns have their changed-files list expanded past MAX_VISIBLE_CHANGED_FILES.
  const [expandedFileListByTurnId, setExpandedFileListByTurnId] = useState<Record<string, boolean>>(
    {},
  );
  const [expandedUserMessagesById, setExpandedUserMessagesById] = useState<Record<string, boolean>>(
    {},
  );
  const [editingUserMessageId, setEditingUserMessageId] = useState<MessageId | null>(null);
  const [submittingEditedUserMessageId, setSubmittingEditedUserMessageId] =
    useState<MessageId | null>(null);
  // Transient highlight applied to a message jumped-to from the pinned-message checklist.
  const [highlightedMessageId, setHighlightedMessageId] = useState<MessageId | null>(null);
  // Index markers once per update so each assistant row avoids a full marker scan.
  const threadMarkersByMessageId = useMemo<ReadonlyMap<MessageId, readonly ThreadMarker[]>>(() => {
    if (threadMarkers.length === 0) {
      return EMPTY_THREAD_MARKERS_BY_MESSAGE_ID;
    }
    const byMessageId = new Map<MessageId, ThreadMarker[]>();
    for (const marker of threadMarkers) {
      const messageMarkers = byMessageId.get(marker.messageId);
      if (messageMarkers) {
        messageMarkers.push(marker);
      } else {
        byMessageId.set(marker.messageId, [marker]);
      }
    }
    return byMessageId;
  }, [threadMarkers]);
  const fallbackListRef = useRef<LegendListRef | null>(null);
  const resolvedListRef = listRef ?? fallbackListRef;
  const timelineRootRef = useRef<HTMLDivElement | null>(null);
  const liveWorkViewportAnchorRef = useRef<{
    sessionId: MessageId;
    workGroupId: string;
    top: number;
    visualOffset: number;
  } | null>(null);
  const liveWorkViewportTargetRef = useRef<HTMLElement | null>(null);
  const liveWorkViewportCorrectionRef = useRef<(() => void) | null>(null);
  const liveWorkViewportAnchorSuspendedRef = useRef(false);
  const presentedWorktreeSetup = useWorktreeSetupPresentation(worktreeSetup);
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        isWorking,
        worktreeSetup: presentedWorktreeSetup?.snapshot ?? null,
        worktreeSetupOpen: presentedWorktreeSetup?.open ?? false,
        activeTurnInProgress,
        activeTurnId,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId,
      }),
    [
      timelineEntries,
      isWorking,
      presentedWorktreeSetup,
      activeTurnInProgress,
      activeTurnId,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
      revertTurnCountByUserMessageId,
    ],
  );
  const rows = useStableRows(rawRows);
  const shouldReleaseTailAnchorToLiveOutput = useMemo(
    () =>
      followLiveOutput &&
      rows.some(
        (row) =>
          row.kind === "message" &&
          row.message.role === "assistant" &&
          row.message.streaming &&
          row.message.text.length > 0 &&
          ((row.leadingWorkEntries?.length ?? 0) > 0 || (row.inlineWorkEntries?.length ?? 0) > 0),
      ),
    [followLiveOutput, rows],
  );
  const tailAnchorReleased =
    tailAnchorMessageId !== null &&
    (releasedTailAnchorMessageId === tailAnchorMessageId || shouldReleaseTailAnchorToLiveOutput);
  useLayoutEffect(() => {
    if (!tailAnchorMessageId || !shouldReleaseTailAnchorToLiveOutput) return;
    setReleasedTailAnchorMessageId((current) =>
      current === tailAnchorMessageId ? current : tailAnchorMessageId,
    );
  }, [shouldReleaseTailAnchorToLiveOutput, tailAnchorMessageId]);
  const activeTailAnchorMessageId = tailAnchorReleased ? null : tailAnchorMessageId;
  const tailAnchorSlideInFlight =
    activeTailAnchorMessageId !== null && activeTailAnchorMessageId !== settledTailAnchorMessageId;
  useLayoutEffect(() => {
    if (!tailAnchorReleased || tailAnchorMessageId === null) {
      if (liveWorkViewportTargetRef.current) {
        liveWorkViewportTargetRef.current.style.translate = "";
      }
      liveWorkViewportAnchorRef.current = null;
      liveWorkViewportTargetRef.current = null;
      liveWorkViewportCorrectionRef.current = null;
      liveWorkViewportAnchorSuspendedRef.current = false;
      return;
    }
    if (liveWorkViewportAnchorSuspendedRef.current) return;

    const container = resolvedListRef.current?.getScrollableNode?.();
    const root = timelineRootRef.current;
    if (!(container instanceof HTMLElement) || !root) return;

    const workGroups = [...root.querySelectorAll<HTMLElement>("[data-live-work-group-id]")].filter(
      (element) => element.getClientRects().length > 0,
    );
    const target = workGroups.at(-1);
    const workGroupId = target?.dataset.liveWorkGroupId;
    if (!target || !workGroupId) {
      if (liveWorkViewportTargetRef.current) {
        liveWorkViewportTargetRef.current.style.translate = "";
      }
      liveWorkViewportAnchorRef.current = null;
      liveWorkViewportTargetRef.current = null;
      liveWorkViewportCorrectionRef.current = null;
      return;
    }

    const preserveTargetCoordinate = () => {
      if (liveWorkViewportAnchorSuspendedRef.current || !target.isConnected) return;
      const previous = liveWorkViewportAnchorRef.current;
      const sameAnchor =
        previous?.sessionId === tailAnchorMessageId && previous.workGroupId === workGroupId;
      const sameTarget = sameAnchor && liveWorkViewportTargetRef.current === target;
      const currentVisualOffset = sameTarget ? previous.visualOffset : 0;
      const currentLayoutTop = target.getBoundingClientRect().top - currentVisualOffset;
      const desiredTop = sameAnchor ? previous.top : currentLayoutTop;
      const delta = currentLayoutTop - desiredTop;
      let visualOffset = 0;
      if (Math.abs(delta) >= 0.5) {
        const previousScrollTop = container.scrollTop;
        container.scrollTop += delta;
        const appliedScrollDelta = container.scrollTop - previousScrollTop;
        visualOffset = -(delta - appliedScrollDelta);
        target.style.translate = Math.abs(visualOffset) >= 0.5 ? `0 ${String(visualOffset)}px` : "";
      } else if (Math.abs(currentVisualOffset) >= 0.5) {
        target.style.translate = "";
      }
      if (!sameTarget && liveWorkViewportTargetRef.current) {
        liveWorkViewportTargetRef.current.style.translate = "";
      }
      liveWorkViewportTargetRef.current = target;
      liveWorkViewportAnchorRef.current = {
        sessionId: tailAnchorMessageId,
        workGroupId,
        top: desiredTop,
        visualOffset,
      };
    };

    preserveTargetCoordinate();
    liveWorkViewportCorrectionRef.current = preserveTargetCoordinate;
    const messageRow = target.closest<HTMLElement>("[data-message-id]");
    if (!messageRow || typeof ResizeObserver === "undefined") {
      return () => {
        if (liveWorkViewportCorrectionRef.current === preserveTargetCoordinate) {
          liveWorkViewportCorrectionRef.current = null;
        }
      };
    }

    const observer = new ResizeObserver(preserveTargetCoordinate);
    observer.observe(messageRow);
    return () => {
      observer.disconnect();
      if (liveWorkViewportCorrectionRef.current === preserveTargetCoordinate) {
        liveWorkViewportCorrectionRef.current = null;
      }
    };
  }, [resolvedListRef, rows, tailAnchorMessageId, tailAnchorReleased, timelineEntries]);
  const handleLiveMarkdownLayout = useCallback(() => {
    liveWorkViewportCorrectionRef.current?.();
  }, []);
  useEffect(() => {
    const container = resolvedListRef.current?.getScrollableNode?.();
    if (!(container instanceof HTMLElement) || !tailAnchorReleased) return;
    const suspend = () => {
      if (liveWorkViewportTargetRef.current) {
        liveWorkViewportTargetRef.current.style.translate = "";
      }
      liveWorkViewportAnchorSuspendedRef.current = true;
      liveWorkViewportAnchorRef.current = null;
      liveWorkViewportTargetRef.current = null;
    };
    container.addEventListener("pointerdown", suspend, { passive: true });
    container.addEventListener("touchstart", suspend, { passive: true });
    container.addEventListener("wheel", suspend, { passive: true });
    return () => {
      container.removeEventListener("pointerdown", suspend);
      container.removeEventListener("touchstart", suspend);
      container.removeEventListener("wheel", suspend);
    };
  }, [resolvedListRef, tailAnchorReleased]);
  useTailAnchorScroll({
    listRef: resolvedListRef,
    timelineRootRef,
    // An inherited anchor already reached its resting position before this
    // mount; the list bootstraps there via `initialScrollAtEnd` instead. Once
    // real narration and work interleave, the live tail becomes the permanent
    // scroll owner for this send so later tool-only gaps cannot recreate the
    // reserved sent-message anchor.
    anchorMessageId: hasInheritedTailAnchor ? null : activeTailAnchorMessageId,
    anchorScrollInFlightRef: tailAnchorScrollInFlightRef,
    onAnchorSlideFinished: handleTailAnchorSlideFinished,
    contentChangeSignal: timelineEntries,
    animateAnchorSlide: !followLiveOutput,
  });
  // Live → settled handoff: open folded process details for one frame, then close
  // with the shared disclosure motion so settlement is not a hard height delete.
  const settleOpenByActivityId = useTurnActivitySettleTransitions(rows);
  const alwaysRenderedTurnActivityRows = useMemo(() => {
    const keys: string[] = [];
    for (let index = rows.length - 1; index >= 0 && keys.length < 2; index -= 1) {
      const row = rows[index];
      if (row?.kind === "turn-activity") keys.push(row.id);
    }
    return { keys };
  }, [rows]);
  const canRenderForkSourceDivider = forkSource !== null && onOpenThread !== undefined;
  const forkSourceDivider = useMemo(
    () =>
      forkSource && onOpenThread ? (
        <ForkSourceDivider source={forkSource} onOpenSourceThread={onOpenThread} />
      ) : null,
    [forkSource, onOpenThread],
  );
  const forkDividerBeforeRowId = useMemo(() => {
    if (!canRenderForkSourceDivider) {
      return null;
    }
    let lastImportedMessageIndex = -1;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      if (row.kind === "message" && row.message.source === "fork-import") {
        lastImportedMessageIndex = index;
      }
    }
    return rows[lastImportedMessageIndex + 1]?.id ?? null;
  }, [canRenderForkSourceDivider, rows]);
  const forkDividerAtEnd = canRenderForkSourceDivider && forkDividerBeforeRowId === null;
  // Fixed bottom content inset. The variable space that lets a just-sent
  // message anchor at the viewport top is reserved natively by LegendList's
  // `anchoredEndSpace` below, not by resizing this footer — resizing the footer
  // from outside fights the list's own footer-layout and initial-scroll
  // machinery (visible as send-time scroll jumps).
  const listFooter = useMemo(
    () => (
      <div>
        {forkDividerAtEnd ? (
          <div className={cn(CHAT_COLUMN_FRAME_CLASS_NAME, "px-1")}>{forkSourceDivider}</div>
        ) : null}
        {footerContent}
        <div
          aria-hidden="true"
          data-tail-anchor-spacer="true"
          style={{ height: BOTTOM_CONTENT_INSET_PX }}
        />
      </div>
    ),
    [footerContent, forkDividerAtEnd, forkSourceDivider],
  );
  // Native reserve for the anchored send: LegendList sizes an end space so the
  // anchor row can sit at the viewport top when scrolled to the end, keeps that
  // reserve in sync with measured tail sizes inside its own layout pass, and
  // shrinks it to zero as the streaming response grows (automatic hand-off to
  // follow-the-tail). `anchorOffset` carries the container's own CSS vertical
  // padding, which the list cannot see (it only reads style props), so that
  // "at end" lands the anchor exactly one top-inset below the viewport top.
  const tailAnchorRowIndex = useMemo(() => {
    if (activeTailAnchorMessageId === null) {
      return -1;
    }
    return rows.findIndex(
      (row) => row.kind === "message" && row.message.id === activeTailAnchorMessageId,
    );
  }, [activeTailAnchorMessageId, rows]);
  const [anchorVerticalInsetPx, setAnchorVerticalInsetPx] = useState(0);
  useLayoutEffect(() => {
    if (activeTailAnchorMessageId === null) {
      return;
    }
    const node: unknown = resolvedListRef.current?.getScrollableNode?.();
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const style = getComputedStyle(node);
    const inset =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    setAnchorVerticalInsetPx((current) => (Math.abs(current - inset) > 0.5 ? inset : current));
  }, [activeTailAnchorMessageId, resolvedListRef]);
  const anchoredEndSpace = useMemo(
    () =>
      tailAnchorRowIndex < 0
        ? undefined
        : {
            anchorIndex: tailAnchorRowIndex,
            anchorOffset: anchorVerticalInsetPx,
          },
    [anchorVerticalInsetPx, tailAnchorRowIndex],
  );
  // Surface the live reserve for tests/diagnostics without re-rendering. The
  // signal (unlike `onSizeChanged`) also reports the collapse to zero after the
  // anchor is cleared, when no config object exists to receive a callback.
  useEffect(() => {
    const state = resolvedListRef.current?.getState?.();
    return state?.listen?.("anchoredEndSpaceSize", (size) => {
      timelineRootRef.current?.setAttribute("data-anchored-end-space", String(Math.round(size)));
    });
  }, [resolvedListRef]);
  // The newest work group renders its rows inline while the turn is live; every
  // older run of tool calls folds into a "Ran N commands..." summary row.
  const lastLiveWorkGroupId = useMemo(() => findLastLiveWorkGroupId(rows), [rows]);
  const firstUserMessageId = useMemo(() => {
    for (const row of rows) {
      if (row.kind === "message" && row.message.role === "user") {
        return row.message.id;
      }
    }
    return null;
  }, [rows]);
  // Last message that still belongs to the pre-fork history (imported context).
  // Messages after `forkCreatedAt` are new turns on the forked thread.
  const forkBoundaryMessageId = useMemo(() => {
    if (!forkSourceThreadId || !forkCreatedAt) return null;
    const boundaryMs = Date.parse(forkCreatedAt);
    if (!Number.isFinite(boundaryMs)) return null;
    let last: MessageId | null = null;
    for (const row of rows) {
      if (row.kind !== "message") continue;
      const createdMs = Date.parse(row.message.createdAt);
      if (!Number.isFinite(createdMs)) continue;
      // Imported history keeps original timestamps (older than fork creation).
      // Allow a small skew for clock/persist ordering on the fork create edge.
      if (createdMs <= boundaryMs + 1500) {
        last = row.message.id;
      }
    }
    return last;
  }, [forkCreatedAt, forkSourceThreadId, rows]);
  const enteringMessageRowIds = useMessageSendEnterAnimations(rows, enteringUserMessageIds);
  const timelineExtraData = useMemo(
    () => ({
      crossTaskOrigin,
      editingUserMessageId,
      enteringMessageRowIds,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedFileListByTurnId,
      expandedUserMessagesById,
      expandedWorkGroupsState,
      firstUserMessageId,
      forkBoundaryMessageId,
      forkSourceThreadId,
      highlightedMessageId,
      lastLiveWorkGroupId,
      pinnedMessageIds,
      settleOpenByActivityId,
      submittingEditedUserMessageId,
      threadMarkersByMessageId,
      toolGroupSummaryOverrides,
    }),
    [
      crossTaskOrigin,
      editingUserMessageId,
      enteringMessageRowIds,
      expandedCollapsedWork,
      expandedFileChangesByTurnId,
      expandedFileListByTurnId,
      expandedUserMessagesById,
      expandedWorkGroupsState,
      firstUserMessageId,
      forkBoundaryMessageId,
      forkSourceThreadId,
      highlightedMessageId,
      lastLiveWorkGroupId,
      pinnedMessageIds,
      settleOpenByActivityId,
      submittingEditedUserMessageId,
      threadMarkersByMessageId,
      toolGroupSummaryOverrides,
    ],
  );
  // Latest rows kept in a ref so the imperative scroll controller can look up a message's
  // index lazily without re-installing the controller on every transcript change.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const jumpHighlightTimeoutRef = useRef<number | null>(null);
  const markerFineScrollFrameRef = useRef<number | null>(null);
  // Marker spans currently carrying the deep-link "active" ring, tracked so the decoration can be
  // toggled imperatively (no markdown re-parse) and reliably cleared on the next jump or teardown.
  const decoratedMarkerElementsRef = useRef<HTMLElement[]>([]);
  const clearActiveMarkerDecoration = useCallback(() => {
    for (const element of decoratedMarkerElementsRef.current) {
      element.classList.remove(ACTIVE_MARKER_CLASS_NAME);
    }
    decoratedMarkerElementsRef.current = [];
  }, []);
  const applyActiveMarkerDecoration = useCallback(
    (elements: readonly HTMLElement[]) => {
      clearActiveMarkerDecoration();
      for (const element of elements) {
        element.classList.add(ACTIVE_MARKER_CLASS_NAME);
      }
      decoratedMarkerElementsRef.current = [...elements];
    },
    [clearActiveMarkerDecoration],
  );
  useEffect(
    () => () => {
      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      if (markerFineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(markerFineScrollFrameRef.current);
      }
      clearActiveMarkerDecoration();
    },
    [clearActiveMarkerDecoration],
  );
  useEffect(() => {
    if (!controllerRef) {
      return;
    }
    const scrollToMessage = (messageId: MessageId) => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === "message" && row.message.id === messageId,
      );
      if (index < 0) {
        return false;
      }
      scrollLegendListToIndex(resolvedListRef, {
        index,
        animated: true,
        viewPosition: 0.2,
      });
      return true;
    };
    const clearJumpHighlightAfterDelay = () => {
      if (jumpHighlightTimeoutRef.current !== null) {
        window.clearTimeout(jumpHighlightTimeoutRef.current);
      }
      jumpHighlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedMessageId(null);
        clearActiveMarkerDecoration();
        jumpHighlightTimeoutRef.current = null;
      }, JUMP_HIGHLIGHT_DURATION_MS);
    };
    const cancelPendingMarkerFineScroll = () => {
      if (markerFineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(markerFineScrollFrameRef.current);
        markerFineScrollFrameRef.current = null;
      }
    };
    const scheduleMarkerFineScroll = (marker: ThreadMarker) => {
      cancelPendingMarkerFineScroll();
      const deadlineMs = getMonotonicTimeMs() + MARKER_FINE_SCROLL_RETRY_TIMEOUT_MS;
      let attempts = 0;
      const tick = () => {
        markerFineScrollFrameRef.current = null;
        const elements = collectThreadMarkerElements(timelineRootRef.current, marker);
        const visibleElement = findVisibleThreadMarkerElement(elements);
        if (visibleElement) {
          applyActiveMarkerDecoration(elements);
          visibleElement.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
          return;
        }
        attempts += 1;
        if (getMonotonicTimeMs() <= deadlineMs && attempts < MARKER_FINE_SCROLL_MAX_RETRY_FRAMES) {
          markerFineScrollFrameRef.current = window.requestAnimationFrame(tick);
        }
      };
      markerFineScrollFrameRef.current = window.requestAnimationFrame(tick);
    };
    const controller: MessagesTimelineController = {
      scrollToMessage: (messageId) => {
        cancelPendingMarkerFineScroll();
        clearActiveMarkerDecoration();
        if (!scrollToMessage(messageId)) {
          return;
        }
        setHighlightedMessageId(messageId);
        clearJumpHighlightAfterDelay();
      },
      scrollToMarker: (marker) => {
        clearActiveMarkerDecoration();
        if (!scrollToMessage(marker.messageId)) {
          return;
        }
        setHighlightedMessageId(marker.messageId);
        clearJumpHighlightAfterDelay();
        scheduleMarkerFineScroll(marker);
      },
    };
    controllerRef.current = controller;
    return () => {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [controllerRef, resolvedListRef, applyActiveMarkerDecoration, clearActiveMarkerDecoration]);
  const tailContentRowId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]!;
      if (row.kind !== "worktree-setup") return row.id;
    }
    return null;
  }, [rows]);
  const tailScrollFrameRef = useRef<number | null>(null);
  const tailScrollTimeoutsRef = useRef<number[]>([]);
  const clearTailExpansionScrollTimers = useCallback(() => {
    if (tailScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(tailScrollFrameRef.current);
      tailScrollFrameRef.current = null;
    }
    for (const timeoutId of tailScrollTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    tailScrollTimeoutsRef.current = [];
  }, []);
  const scrollTailExpansionToEnd = useCallback(() => {
    clearTailExpansionScrollTimers();
    const scrollToEnd = () => {
      scrollLegendListToEnd(resolvedListRef);
    };
    tailScrollFrameRef.current = window.requestAnimationFrame(() => {
      tailScrollFrameRef.current = null;
      scrollToEnd();
    });
    for (const delay of [80, 180, 260]) {
      const timeoutId = window.setTimeout(scrollToEnd, delay);
      tailScrollTimeoutsRef.current.push(timeoutId);
    }
  }, [clearTailExpansionScrollTimers, resolvedListRef]);
  useEffect(() => clearTailExpansionScrollTimers, [clearTailExpansionScrollTimers]);
  const ignoreTimelineImageLoad = useCallback(() => {}, []);
  const latestEditableUserMessageId = editableUserMessageId ?? null;
  const previousRowCountRef = useRef(rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;
    if (previousRowCount > 0 || rows.length === 0) {
      return;
    }
    onIsAtEndChange?.(true);
    const frameId = window.requestAnimationFrame(() => {
      scrollLegendListToEnd(resolvedListRef);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [onIsAtEndChange, resolvedListRef, rows.length]);
  // Sent-message anchors (id + position in the virtualized row list) for the
  // navigation trail. Held in a ref so the viewability callback stays stable and
  // doesn't re-subscribe LegendList on every transcript change.
  const userMessageAnchors = useMemo<MessageTrailAnchor[]>(() => {
    const anchors: MessageTrailAnchor[] = [];
    rows.forEach((row, index) => {
      if (row.kind === "message" && row.message.role === "user") {
        anchors.push({ id: row.message.id, rowIndex: index });
      }
    });
    return anchors;
  }, [rows]);
  const userMessageAnchorsRef = useRef(userMessageAnchors);
  useLayoutEffect(() => {
    userMessageAnchorsRef.current = userMessageAnchors;
  }, [userMessageAnchors]);
  const emitTrailHighlightsForViewport = useCallback(
    (topRowIndex: number, bottomRowIndex: number) => {
      if (!onTrailHighlightsChange || !Number.isFinite(topRowIndex)) {
        return;
      }
      onTrailHighlightsChange(
        resolveActiveTrailSnapshot(userMessageAnchorsRef.current, topRowIndex, bottomRowIndex),
      );
    },
    [onTrailHighlightsChange],
  );
  const handleListScroll = useCallback<NonNullable<MessagesTimelineProps["onMessagesScroll"]>>(
    (event) => {
      liveWorkViewportCorrectionRef.current?.();
      onMessagesScroll?.(event);
      const state = readLegendListState(resolvedListRef);
      if (state) {
        onIsAtEndChange?.(state.isAtEnd);
        emitTrailHighlightsForViewport(state.start, state.end);
      }
    },
    [emitTrailHighlightsForViewport, onIsAtEndChange, onMessagesScroll, resolvedListRef],
  );
  const handleViewableItemsChanged = useCallback<
    NonNullable<ComponentProps<typeof LegendList>["onViewableItemsChanged"]>
  >(
    ({ viewableItems }) => {
      let topIndex = Number.POSITIVE_INFINITY;
      let bottomIndex = Number.NEGATIVE_INFINITY;
      for (const token of viewableItems) {
        if (token.isViewable) {
          topIndex = Math.min(topIndex, token.index);
          bottomIndex = Math.max(bottomIndex, token.index);
        }
      }
      emitTrailHighlightsForViewport(topIndex, bottomIndex);
    },
    [emitTrailHighlightsForViewport],
  );
  useEffect(() => {
    if (!onTrailHighlightsChange) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      const state = readLegendListState(resolvedListRef);
      if (state) {
        emitTrailHighlightsForViewport(state.start, state.end);
      }
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [emitTrailHighlightsForViewport, onTrailHighlightsChange, resolvedListRef, rows.length]);
  const toggleFileChangesExpanded = useCallback((turnId: TurnId) => {
    setExpandedFileChangesByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? true),
    }));
  }, []);
  const toggleFileListExpanded = useCallback((turnId: TurnId) => {
    setExpandedFileListByTurnId((current) => ({
      ...current,
      [turnId]: !(current[turnId] ?? false),
    }));
  }, []);
  const cancelUserMessageEdit = useCallback(() => {
    setEditingUserMessageId(null);
  }, []);
  const startUserMessageEdit = useCallback((messageId: MessageId) => {
    setEditingUserMessageId(messageId);
  }, []);
  const submitUserMessageEdit = useCallback(
    (messageId: MessageId, text: string, allowEmpty = false) => {
      if (!onEditUserMessage) {
        return Promise.resolve();
      }
      const nextText = text.trim();
      if (!nextText && !allowEmpty) {
        return Promise.resolve();
      }
      setSubmittingEditedUserMessageId(messageId);
      // Promise chain instead of async/try-finally: React Compiler does not yet
      // support try/finally, and it would skip optimizing this whole component.
      return Promise.resolve(onEditUserMessage(messageId, nextText))
        .then((saved) => {
          if (saved) {
            cancelUserMessageEdit();
          }
        })
        .finally(() => {
          setSubmittingEditedUserMessageId(null);
        });
    },
    [cancelUserMessageEdit, onEditUserMessage],
  );

  const renderRowContent = (row: MessagesTimelineRow) => (
    <div
      className={cn(
        CHAT_COLUMN_FRAME_CLASS_NAME,
        "px-1 transition-colors duration-500",
        row.kind === "work" ||
          row.kind === "reasoning-status" ||
          row.kind === "turn-activity" ||
          (row.kind === "message" && row.message.role === "assistant")
          ? "pb-2"
          : "pb-4",
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
        row.kind === "message" && row.message.id === highlightedMessageId
          ? "rounded-xl bg-[var(--color-background-elevated-secondary)]"
          : null,
        enteringMessageRowIds.has(row.id) ? "chat-message-send-enter" : null,
      )}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {forkDividerBeforeRowId === row.id ? forkSourceDivider : null}
      {row.kind === "work" &&
        (() => {
          const groupId = row.id;
          // Creation milestones are reserved for the end-of-turn recap card.
          // The provider's actual Veylen MCP tool rows remain visible here.
          const groupedEntries = row.groupedEntries.filter(
            (workEntry) => !workEntry.veylenThreadCreation,
          );
          if (groupedEntries.length === 0) {
            return null;
          }
          const renderEntryRow = (workEntry: WorkLogEntry) => (
            <TimelineWorkEntryRow
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              chatMetaFontSizePx={appTypographyScale.chatMetaPx}
              textFontSizePx={normalizedChatFontSizePx}
              density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
              markdownCwd={markdownCwd}
              onImageExpand={onImageExpand}
              timestampFormat={timestampFormat}
              {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
              {...(onOpenAutomation ? { onOpenAutomation } : {})}
              {...(onOpenThread ? { onOpenThread } : {})}
            />
          );
          const renderSummaryEntryRow = (workEntry: WorkLogEntry) => (
            <TimelineWorkEntryRow
              key={`work-summary-detail:${workEntry.id}`}
              workEntry={workEntry}
              chatMetaFontSizePx={appTypographyScale.chatMetaPx}
              textFontSizePx={normalizedChatFontSizePx}
              density="compact"
              presentation="summary-detail"
              markdownCwd={markdownCwd}
              onImageExpand={onImageExpand}
              timestampFormat={timestampFormat}
              {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
              {...(onOpenAutomation ? { onOpenAutomation } : {})}
              {...(onOpenThread ? { onOpenThread } : {})}
            />
          );
          const isLiveGroup =
            groupId === lastLiveWorkGroupId && (activeTurnInProgress || isWorking);
          const isExpanded = expandedWorkGroupsState[groupId] ?? false;
          const plannedRenderChunks = planWorkEntryRenderChunks(groupedEntries, {
            tailIsLive: isLiveGroup,
          });
          const cappedRenderPlan = capOpenWorkEntryRenderChunks(plannedRenderChunks, {
            expanded: isExpanded,
            maxVisibleEntries: MAX_VISIBLE_WORK_LOG_ENTRIES,
            keep: "last",
          });
          const renderChunks = cappedRenderPlan.chunks;
          const hasCollapsedChunk = renderChunks.some((chunk) => chunk.summary !== null);
          if (hasCollapsedChunk) {
            return (
              <div>
                <div className="space-y-0.5">
                  {renderChunks.map((chunk) => {
                    if (!chunk.summary) return chunk.entries.map(renderEntryRow);
                    const summary = chunk.summary;
                    const summaryKey = `${groupId}:${chunk.id}`;
                    return (
                      <ToolCallGroupSummaryRow
                        key={`tool-summary:${summaryKey}`}
                        summary={summary}
                        headline={chunk.headline}
                        open={isExpanded || (toolGroupSummaryOverrides[summaryKey] ?? false)}
                        onToggle={(open) => setToolGroupSummaryOpen(summaryKey, open)}
                        fontSizePx={normalizedChatFontSizePx}
                        live={chunk.live}
                        renderChildren={() => (
                          <div className="space-y-0.5 pt-0.5">
                            {chunk.entries
                              .filter(isSummarizableToolCallEntry)
                              .map(renderSummaryEntryRow)}
                          </div>
                        )}
                      />
                    );
                  })}
                </div>
                {cappedRenderPlan.hasOverflow && (
                  <div className="mt-1.5 flex items-center justify-start gap-2 px-0.5">
                    <button
                      type="button"
                      className="font-system-ui text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
                      style={{ fontSize: `${appTypographyScale.uiSmPx}px` }}
                      onClick={() => handleToggleWorkGroup(groupId)}
                    >
                      {isExpanded ? "Show less" : `Show ${cappedRenderPlan.hiddenEntryCount} more`}
                    </button>
                  </div>
                )}
              </div>
            );
          }
          const hasOverflow = groupedEntries.length > MAX_VISIBLE_WORK_LOG_ENTRIES;
          const visibleEntries =
            hasOverflow && !isExpanded
              ? groupedEntries.slice(-MAX_VISIBLE_WORK_LOG_ENTRIES)
              : groupedEntries;
          const hiddenCount = groupedEntries.length - visibleEntries.length;
          const showOverflowToggle = hasOverflow;

          return (
            <div>
              <div className="space-y-0.5">{visibleEntries.map(renderEntryRow)}</div>
              {showOverflowToggle && (
                <div className="mt-1.5 flex items-center justify-start gap-2 px-0.5">
                  <button
                    type="button"
                    className="font-system-ui text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/75"
                    style={{ fontSize: `${appTypographyScale.uiSmPx}px` }}
                    onClick={() => handleToggleWorkGroup(groupId)}
                  >
                    {isExpanded ? "Show less" : `Show ${hiddenCount} more`}
                  </button>
                </div>
              )}
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = (row.message.attachments ?? []).filter(
            (
              attachment,
            ): attachment is Extract<
              NonNullable<TimelineMessage["attachments"]>[number],
              { type: "image" }
            > => attachment.type === "image",
          );
          const assistantSelections = (row.message.attachments ?? []).filter(
            (
              attachment,
            ): attachment is Extract<
              NonNullable<TimelineMessage["attachments"]>[number],
              { type: "assistant-selection" }
            > => attachment.type === "assistant-selection",
          );
          const userFiles = (row.message.attachments ?? []).filter(
            (
              attachment,
            ): attachment is Extract<
              NonNullable<TimelineMessage["attachments"]>[number],
              { type: "file" }
            > => attachment.type === "file",
          );
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text, {
            hideImageOnlyBootstrapPrompt:
              userImages.length > 0 || userFiles.length > 0 || assistantSelections.length > 0,
            messageId: row.message.id,
          });
          const renderedAssistantSelections =
            assistantSelections.length > 0
              ? assistantSelections
              : displayedUserMessage.assistantSelections.map((selection, index) => ({
                  type: "assistant-selection" as const,
                  id: `fallback-selection-${row.message.id}-${index}`,
                  assistantMessageId: selection.assistantMessageId,
                  text: selection.text,
                }));
          const terminalContexts = displayedUserMessage.contexts;
          const renderedFileComments = displayedUserMessage.fileComments;
          const renderedPastedTexts = displayedUserMessage.pastedTexts;
          const renderedBrowserAnnotations = displayedUserMessage.browserAnnotations;
          const userMessageText = displayedUserMessage.visibleText;
          const userMessageExpanded = expandedUserMessagesById[row.message.id] ?? false;
          const showUserText = userMessageText.trim().length > 0 || terminalContexts.length > 0;
          const bubbleIsChipOnly =
            showUserText &&
            terminalContexts.length === 0 &&
            hasOnlyInlineSkillChips(userMessageText, row.message.mentions ?? []);
          const canRevertAgentWork = typeof row.revertTurnCount === "number";
          const isEditingThisMessage = editingUserMessageId === row.message.id;
          const isSubmittingThisEdit = submittingEditedUserMessageId === row.message.id;
          const showEditUserMessage =
            Boolean(onEditUserMessage) &&
            row.message.id === latestEditableUserMessageId &&
            (displayedUserMessage.copyText.trim().length > 0 ||
              renderedBrowserAnnotations.length > 0);
          const hasLeadingMedia = hasLeadingUserMedia({
            imageCount: userImages.length,
            fileCount: userFiles.length,
            assistantSelectionCount: renderedAssistantSelections.length,
            browserAnnotationCount: renderedBrowserAnnotations.length,
            fileCommentCount: renderedFileComments.length,
            pastedTextCount: renderedPastedTexts.length,
          });
          const isTailContentRow = row.id === tailContentRowId;
          const showCrossTaskOrigin =
            crossTaskOrigin !== null && row.message.id === firstUserMessageId;
          return (
            <div className="flex w-full flex-col gap-3">
              {showCrossTaskOrigin ? (
                <CrossTaskOriginLabel
                  origin={crossTaskOrigin}
                  {...(onOpenThread ? { onOpenSourceThread: onOpenThread } : {})}
                />
              ) : null}
              <div className="flex w-full justify-end">
                <div
                  className={cn(
                    "group flex flex-col items-end gap-px",
                    isEditingThisMessage ? "w-full max-w-full" : "max-w-[80%]",
                  )}
                >
                  {/* Keep user-message chrome outside the bubble so the message reads as one simple block. */}
                  {/* The cross-task origin label already attributes this turn to another Veylen thread,
                      so suppress the dispatch chip here to avoid a duplicate "Sent by …" marker. */}
                  {showCrossTaskOrigin ? null : (
                    <UserDispatchModeChip
                      dispatchMode={row.message.dispatchMode}
                      dispatchOrigin={row.message.dispatchOrigin}
                      hasLeadingMedia={hasLeadingMedia}
                    />
                  )}
                  {renderedAssistantSelections.length > 0 && (
                    <div className="mb-1 flex max-w-[240px] flex-wrap justify-end gap-1.5 self-end">
                      <AssistantSelectionsSummaryChip selections={renderedAssistantSelections} />
                    </div>
                  )}
                  {renderedBrowserAnnotations.length > 0 && (
                    <div className="mb-1 flex w-full max-w-[28rem] justify-end self-end">
                      <BrowserAnnotationStrip
                        annotations={renderedBrowserAnnotations}
                        className="justify-end"
                      />
                    </div>
                  )}
                  {renderedFileComments.length > 0 && (
                    <div className="mb-1 flex max-w-[240px] flex-wrap justify-end gap-1.5 self-end">
                      <FileCommentsSummaryChip comments={renderedFileComments} />
                    </div>
                  )}
                  {renderedPastedTexts.length > 0 && (
                    <div className="mb-1 flex max-w-full flex-col items-end gap-1.5 self-end">
                      {renderedPastedTexts.map((pasted) => (
                        <UserMessagePastedTextCard
                          key={pasted.index}
                          text={pasted.text}
                          metrics={{ lineCount: pasted.lineCount, charCount: pasted.charCount }}
                        />
                      ))}
                    </div>
                  )}
                  {userFiles.length > 0 && (
                    <div className="mb-1 flex max-w-[280px] flex-wrap justify-end gap-1.5 self-end">
                      {userFiles.map((file) => (
                        <FileAttachmentChip key={file.id} file={file} />
                      ))}
                    </div>
                  )}
                  {userImages.length > 0 && (
                    <div
                      className={cn(
                        "flex max-w-[240px] flex-wrap justify-end gap-2 self-end",
                        showUserText && "mb-1",
                      )}
                    >
                      {userImages.map((image) => (
                        <UserImageAttachmentThumbnail
                          key={image.id}
                          image={image}
                          userImages={userImages}
                          onImageExpand={onImageExpand}
                          onTimelineImageLoad={
                            isTailContentRow ? scrollTailExpansionToEnd : ignoreTimelineImageLoad
                          }
                          resolvedTheme={resolvedTheme}
                        />
                      ))}
                    </div>
                  )}
                  {isEditingThisMessage ? (
                    <UserMessageEditForm
                      key={row.message.id}
                      initialValue={displayedUserMessage.copyText}
                      disabled={isSubmittingThisEdit || isRevertingCheckpoint}
                      allowEmpty={renderedBrowserAnnotations.length > 0}
                      chatTypographyStyle={userMessageTypographyStyle}
                      borderClassName={userMessageBubbleBorderClass}
                      onCancel={cancelUserMessageEdit}
                      onSubmit={(text) =>
                        void submitUserMessageEdit(
                          row.message.id,
                          text,
                          renderedBrowserAnnotations.length > 0,
                        )
                      }
                    />
                  ) : showUserText ? (
                    <div
                      className={cn(
                        "w-max max-w-full min-w-0 self-end bg-[var(--app-user-message-background)]",
                        USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
                        userMessageBubbleBorderClass,
                        bubbleIsChipOnly
                          ? "py-0.5 px-3"
                          : USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
                      )}
                    >
                      <UserMessageCollapsibleText
                        text={userMessageText}
                        expanded={userMessageExpanded}
                        chatFontSizePx={normalizedChatFontSizePx}
                        onToggle={() => {
                          setExpandedUserMessagesById((previous) => ({
                            ...previous,
                            [row.message.id]: !(previous[row.message.id] ?? false),
                          }));
                        }}
                      >
                        <UserMessageBody
                          text={userMessageText}
                          mentionReferences={row.message.mentions ?? []}
                          terminalContexts={terminalContexts}
                          chatTypographyStyle={userMessageTypographyStyle}
                          resolvedTheme={resolvedTheme}
                          markdownCwd={markdownCwd}
                        />
                      </UserMessageCollapsibleText>
                    </div>
                  ) : null}
                  {!isEditingThisMessage && (
                    <div
                      className="flex items-center justify-end gap-2 pr-0.5 font-system-ui font-normal text-muted-foreground/70"
                      style={chatMessageFooterStyle}
                    >
                      <p className="tabular-nums text-muted-foreground/60">
                        {formatShortTimestamp(row.message.createdAt, timestampFormat)}
                      </p>
                      <div className="flex items-center gap-0.5">
                        {displayedUserMessage.copyText && (
                          <MessageCopyButton text={displayedUserMessage.copyText} />
                        )}
                        {showEditUserMessage && (
                          <MessageActionButton
                            label="Edit message"
                            tooltip="Edit and resend"
                            disabled={isRevertingCheckpoint}
                            className="disabled:text-muted-foreground/35"
                            onClick={() => startUserMessageEdit(row.message.id)}
                          >
                            <NewThreadIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                          </MessageActionButton>
                        )}
                        {canRevertAgentWork ? (
                          <MessageActionButton
                            label="Revert to this message"
                            tooltip="Revert to this message"
                            disabled={isRevertingCheckpoint || isWorking}
                            className="disabled:text-muted-foreground/35"
                            onClick={() => onRevertUserMessage(row.message.id)}
                          >
                            <Undo2Icon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                          </MessageActionButton>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = resolveAssistantMessageDisplayText(row);
          const messageMarkers =
            threadMarkersByMessageId.get(row.message.id) ?? EMPTY_MESSAGE_MARKERS;
          const buildWorkDisplay = (workEntries: WorkLogEntry[], workGroupId: string | null) => {
            const displayEntries = workEntries.filter((entry) => !entry.veylenThreadCreation);
            const toolEntries = displayEntries.filter((entry) => entry.tone === "tool");
            const statusEntries = displayEntries.filter(
              (entry) =>
                entry.tone !== "tool" && !(toolEntries.length > 0 && entry.tone === "thinking"),
            );
            const toolGroupId = toolEntries.length > 0 ? workGroupId : null;
            const toolExpanded =
              toolGroupId !== null ? (expandedWorkGroupsState[toolGroupId] ?? false) : false;
            const visibleToolEntries =
              toolExpanded || toolEntries.length <= MAX_VISIBLE_INLINE_TOOL_ENTRIES
                ? toolEntries
                : activeTurnInProgress
                  ? toolEntries.slice(-MAX_VISIBLE_INLINE_TOOL_ENTRIES)
                  : toolEntries.slice(0, MAX_VISIBLE_INLINE_TOOL_ENTRIES);
            const hasGenericFileChangeEntry = toolEntries.some(
              (workEntry) =>
                isFileChangeWorkLogEntry(workEntry) && (workEntry.changedFiles?.length ?? 0) === 0,
            );
            const isRenderableToolEntry = (workEntry: WorkLogEntry) =>
              !(
                hasGenericFileChangeEntry &&
                isFileChangeWorkLogEntry(workEntry) &&
                (workEntry.changedFiles?.length ?? 0) === 0
              );
            return {
              toolEntries,
              statusEntries,
              toolGroupId,
              toolExpanded,
              // Generic provider thinking is presentation noise while a
              // canonical tool purpose is visible. The planner removes it so
              // one purpose remains one disclosure; meaningful info/error rows
              // remain available as explicit status rows below.
              orderedRenderableEntries: displayEntries.filter(isRenderableToolEntry),
              renderableToolEntries: toolEntries.filter(isRenderableToolEntry),
              visibleRenderableToolEntries: visibleToolEntries.filter(isRenderableToolEntry),
              hiddenToolCount: toolEntries.length - visibleToolEntries.length,
              hasGenericFileChangeEntry,
            };
          };
          const leadingWorkDisplay = buildWorkDisplay(
            row.leadingWorkEntries ?? [],
            row.leadingWorkGroupId ?? null,
          );
          const inlineWorkDisplay = buildWorkDisplay(
            row.inlineWorkEntries ?? [],
            row.inlineWorkGroupId ?? null,
          );
          const assistantCopyState = resolveAssistantMessageCopyState({
            text: row.message.text ?? null,
            showCopyButton: row.showAssistantCopyButton,
            streaming: row.assistantCopyStreaming,
          });
          const messagePinned = pinnedMessageIds?.has(row.message.id) ?? false;
          const messageCanPin = canPinMessage?.(row.message.id) ?? true;
          // Offer the pin toggle wherever copy is offered (a complete, terminal answer);
          // keep it visible for an already-pinned message so it can always be unpinned.
          const showPinToggle =
            messageCanPin &&
            Boolean(onTogglePinMessage) &&
            (assistantCopyState.visible || messagePinned);
          // Keep the terminal controls in layout while the turn is live so settlement only
          // reveals them; changing this row's measured height makes LegendList jump the viewport.
          const reserveTerminalAssistantFooter =
            row.showAssistantCopyButton &&
            (assistantCopyState.text !== null || row.message.streaming);
          const reservePinToggle =
            messageCanPin &&
            Boolean(onTogglePinMessage) &&
            (assistantCopyState.text !== null || messagePinned);
          // Fork reuses the same terminal-settled gate as copy: only whole-thread
          // forks from a finished answer, reserved while the turn is still live.
          const reserveForkButton =
            Boolean(onForkThread) &&
            row.showAssistantCopyButton &&
            (assistantCopyState.text !== null || row.message.streaming);
          const showForkButton =
            Boolean(onForkThread) &&
            row.showAssistantCopyButton &&
            !row.assistantTurnInProgress &&
            assistantCopyState.visible;
          const turnSummary = row.assistantTurnDiffSummary;
          const fileDiffStatByPath = new Map(
            (turnSummary?.files ?? []).map((file) => [
              file.path,
              {
                additions: file.additions ?? 0,
                deletions: file.deletions ?? 0,
              },
            ]),
          );
          const inlineEditedFilesFromTurnSummary =
            (leadingWorkDisplay.hasGenericFileChangeEntry ||
              inlineWorkDisplay.hasGenericFileChangeEntry) &&
            (turnSummary?.files.length ?? 0) > 0
              ? turnSummary!.files
              : [];
          // Only the turn's final answer carries a timestamp. Intermediate
          // working preambles (and their inline tool calls) stay timestamp-free
          // so a live turn reads as one block, not a stack of timestamped
          // fragments. `showAssistantCopyButton` is exactly the terminal-message
          // signal (see deriveTerminalAssistantMessageIds).
          const isTerminalAssistantMessage =
            row.showAssistantCopyButton && !row.assistantTurnInProgress;
          const assistantMeta = [
            isTerminalAssistantMessage
              ? formatShortTimestamp(row.message.createdAt, timestampFormat)
              : null,
          ]
            .filter((value): value is string => Boolean(value))
            .join(" • ");
          const allTurnWorkEntries = [
            ...(row.leadingWorkEntries ?? []),
            ...(row.inlineWorkEntries ?? []),
            ...(row.collapsedTurnItems ?? []).flatMap((item) =>
              item.kind === "work" ? [item.entry] : [],
            ),
          ];
          const veylenThreadCreationRecaps = [
            ...new Map(
              allTurnWorkEntries.flatMap((entry) =>
                entry.veylenThreadCreation
                  ? [[entry.veylenThreadCreation.operationId, entry.veylenThreadCreation] as const]
                  : [],
              ),
            ).values(),
          ];
          const isTailContentRow = row.id === tailContentRowId;
          const renderWorkDisplay = (
            display: typeof leadingWorkDisplay,
            placement: "leading" | "inline",
          ) => {
            const renderInlineToolRow = (workEntry: WorkLogEntry) => (
              <TimelineWorkEntryRow
                key={`${placement}-tool-row:${row.message.id}:${workEntry.id}`}
                workEntry={workEntry}
                chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                textFontSizePx={normalizedChatFontSizePx}
                density="compact"
                fileDiffStatByPath={fileDiffStatByPath}
                markdownCwd={markdownCwd}
                onImageExpand={onImageExpand}
                onOpenTurnDiff={onOpenTurnDiff}
                timestampFormat={timestampFormat}
                {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
                {...(onOpenAutomation ? { onOpenAutomation } : {})}
                {...(onOpenThread ? { onOpenThread } : {})}
                {...(turnSummary?.turnId ? { turnId: turnSummary.turnId } : {})}
              />
            );
            const renderInlineSummaryToolRow = (workEntry: WorkLogEntry) => (
              <TimelineWorkEntryRow
                key={`${placement}-tool-summary-detail:${row.message.id}:${workEntry.id}`}
                workEntry={workEntry}
                chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                textFontSizePx={normalizedChatFontSizePx}
                density="compact"
                presentation="summary-detail"
                fileDiffStatByPath={fileDiffStatByPath}
                markdownCwd={markdownCwd}
                onImageExpand={onImageExpand}
                onOpenTurnDiff={onOpenTurnDiff}
                timestampFormat={timestampFormat}
                {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
                {...(onOpenAutomation ? { onOpenAutomation } : {})}
                {...(onOpenThread ? { onOpenThread } : {})}
                {...(turnSummary?.turnId ? { turnId: turnSummary.turnId } : {})}
              />
            );
            const isLiveGroup =
              display.toolGroupId !== null &&
              display.toolGroupId === lastLiveWorkGroupId &&
              (activeTurnInProgress || isWorking);
            const plannedRenderChunks = planWorkEntryRenderChunks(
              display.orderedRenderableEntries,
              {
                tailIsLive: placement === "inline" && isLiveGroup,
              },
            );
            const cappedRenderPlan = capOpenWorkEntryRenderChunks(plannedRenderChunks, {
              expanded: display.toolExpanded,
              maxVisibleEntries: MAX_VISIBLE_INLINE_TOOL_ENTRIES,
              keep: activeTurnInProgress ? "last" : "first",
              shouldCapEntry: (workEntry) => workEntry.tone === "tool",
            });
            const renderChunks = cappedRenderPlan.chunks;
            const collapseAsSummary = renderChunks.some((chunk) => chunk.summary !== null);
            return (
              <>
                {collapseAsSummary && display.renderableToolEntries.length > 0 && (
                  <div
                    className={placement === "leading" ? "mb-3" : "mt-3"}
                    data-live-work-group-id={
                      isLiveGroup ? (display.toolGroupId ?? undefined) : undefined
                    }
                  >
                    <div className="space-y-px">
                      {renderChunks.map((chunk) => {
                        if (!chunk.summary) {
                          // Narration-tone entries render in the status block
                          // below; here they only serve as run boundaries.
                          return chunk.entries
                            .filter((workEntry) => workEntry.tone === "tool")
                            .map(renderInlineToolRow);
                        }
                        const summary = chunk.summary;
                        // Message ids stay stable while a live group's first-entry id can drift.
                        const summaryOverrideKey = `${placement}:${row.message.id}:${chunk.id}`;
                        return (
                          <ToolCallGroupSummaryRow
                            key={`inline-tool-summary:${summaryOverrideKey}`}
                            summary={summary}
                            headline={chunk.headline}
                            // ChatGPT: collapsed until user expands (defaults false).
                            // Summary click sets override; "show more" can expand too.
                            open={
                              display.toolExpanded ||
                              (toolGroupSummaryOverrides[summaryOverrideKey] ?? false)
                            }
                            onToggle={(open) => setToolGroupSummaryOpen(summaryOverrideKey, open)}
                            fontSizePx={normalizedChatFontSizePx}
                            live={chunk.live}
                            renderChildren={() => (
                              <div className="space-y-px pt-0.5">
                                {chunk.entries
                                  .filter(isSummarizableToolCallEntry)
                                  .map(renderInlineSummaryToolRow)}
                              </div>
                            )}
                          />
                        );
                      })}
                    </div>
                    {display.toolGroupId && cappedRenderPlan.hasOverflow && (
                      <div className="py-0.5">
                        <button
                          type="button"
                          className="text-muted-foreground/50 transition-colors duration-150 hover:text-foreground/72"
                          style={{ fontSize: `${normalizedChatFontSizePx}px` }}
                          onClick={() => handleToggleWorkGroup(display.toolGroupId!)}
                        >
                          {display.toolExpanded
                            ? "Show less"
                            : `+${cappedRenderPlan.hiddenEntryCount} more tool calls`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {!collapseAsSummary && display.visibleRenderableToolEntries.length > 0 && (
                  <div
                    className={placement === "leading" ? "mb-3" : "mt-3"}
                    data-live-work-group-id={
                      isLiveGroup ? (display.toolGroupId ?? undefined) : undefined
                    }
                  >
                    <div className="space-y-px">
                      {display.visibleRenderableToolEntries.map(renderInlineToolRow)}
                    </div>
                    {display.toolGroupId &&
                      display.toolEntries.length > MAX_VISIBLE_INLINE_TOOL_ENTRIES && (
                        <div className="py-0.5">
                          <button
                            type="button"
                            className="text-muted-foreground/50 transition-colors duration-150 hover:text-foreground/72"
                            style={{ fontSize: `${normalizedChatFontSizePx}px` }}
                            onClick={() => handleToggleWorkGroup(display.toolGroupId!)}
                          >
                            {display.toolExpanded
                              ? "Show less"
                              : `+${display.hiddenToolCount} more tool calls`}
                          </button>
                        </div>
                      )}
                  </div>
                )}
                {!collapseAsSummary && display.statusEntries.length > 0 && (
                  <div
                    className={cn(
                      "space-y-0.5",
                      placement === "leading"
                        ? row.assistantTurnInProgress
                          ? "mb-0.5"
                          : "mb-2"
                        : "mt-2",
                    )}
                  >
                    {display.statusEntries.map((workEntry) => (
                      <TimelineWorkEntryRow
                        key={`${placement}-status-row:${row.message.id}:${workEntry.id}`}
                        workEntry={workEntry}
                        chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                        textFontSizePx={normalizedChatFontSizePx}
                        density={prefersCompactWorkEntryRow(workEntry) ? "compact" : "default"}
                        markdownCwd={markdownCwd}
                        onImageExpand={onImageExpand}
                        timestampFormat={timestampFormat}
                        {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
                        {...(onOpenAutomation ? { onOpenAutomation } : {})}
                        {...(onOpenThread ? { onOpenThread } : {})}
                      />
                    ))}
                  </div>
                )}
              </>
            );
          };
          return (
            <>
              <div className="group min-w-0 py-0.5">
                {renderWorkDisplay(leadingWorkDisplay, "leading")}
                {messageText !== null ? (
                  <div data-assistant-message-id={row.message.id}>
                    <ChatMarkdown
                      text={messageText}
                      cwd={markdownCwd}
                      isStreaming={Boolean(row.message.streaming)}
                      style={chatTypographyStyle}
                      onImageExpand={onImageExpand}
                      markers={messageMarkers}
                      onRenderedTextLayout={handleLiveMarkdownLayout}
                    />
                  </div>
                ) : null}
                {renderWorkDisplay(inlineWorkDisplay, "inline")}
                {inlineEditedFilesFromTurnSummary.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {inlineEditedFilesFromTurnSummary.map((file) => (
                      <button
                        key={`inline-summary-edit:${row.message.id}:${file.path}`}
                        type="button"
                        className="group/file-row flex w-full max-w-full items-center gap-2 px-0 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none"
                        title={file.path}
                        onClick={() => onOpenTurnDiff(turnSummary!.turnId, file.path)}
                      >
                        <EditedFileRowContent
                          filePath={file.path}
                          additions={file.additions}
                          deletions={file.deletions}
                          fontSizePx={normalizedChatFontSizePx}
                          compact={false}
                        />
                      </button>
                    ))}
                  </div>
                )}
                {(reserveTerminalAssistantFooter ||
                  showPinToggle ||
                  assistantCopyState.visible ||
                  reserveForkButton ||
                  showForkButton ||
                  assistantMeta.length > 0) && (
                  <div
                    className="mt-0.5 flex items-center gap-2 font-system-ui font-normal text-muted-foreground/70"
                    data-assistant-message-footer={
                      isTerminalAssistantMessage ? "settled" : "reserved"
                    }
                    style={chatMessageFooterStyle}
                  >
                    {/* Tight action cluster always visible (pin · copy · fork), then time. */}
                    <div className="flex items-center gap-0.5">
                      {reservePinToggle ? (
                        // Pin stays reserved during streaming so settlement does not jump layout;
                        // once settled it is always painted (not hover-only).
                        <span
                          aria-hidden={showPinToggle ? undefined : true}
                          className={cn(
                            "contents",
                            !showPinToggle && "invisible pointer-events-none",
                          )}
                        >
                          <MessageActionButton
                            label={pinActionLabel("message", messagePinned)}
                            tooltip={messagePinned ? "Unpin from panel" : "Pin to panel"}
                            aria-pressed={messagePinned}
                            className={messagePinned ? "text-muted-foreground" : undefined}
                            onClick={() => onTogglePinMessage?.(row.message.id)}
                          >
                            <PinIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
                          </MessageActionButton>
                        </span>
                      ) : null}
                      {assistantCopyState.text !== null ? (
                        <span
                          aria-hidden={assistantCopyState.visible ? undefined : true}
                          className={cn(
                            "contents",
                            !assistantCopyState.visible && "invisible pointer-events-none",
                          )}
                        >
                          <MessageCopyButton text={assistantCopyState.text} />
                        </span>
                      ) : null}
                      {reserveForkButton || showForkButton ? (
                        // Fork reserved while streaming; always visible once the turn settles.
                        <span
                          aria-hidden={showForkButton ? undefined : true}
                          className={cn(
                            "contents",
                            !showForkButton && "invisible pointer-events-none",
                          )}
                        >
                          <MessageForkButton
                            localDescription={forkLocalDescription}
                            onFork={async (target) => {
                              await onForkThread?.(target);
                            }}
                          />
                        </span>
                      ) : null}
                    </div>
                    {row.showAssistantCopyButton ? (
                      <p
                        aria-hidden={assistantMeta.length > 0 ? undefined : true}
                        className={cn(
                          "tabular-nums text-muted-foreground/60",
                          assistantMeta.length === 0 && "invisible",
                        )}
                      >
                        {assistantMeta ||
                          formatShortTimestamp(row.message.createdAt, timestampFormat)}
                      </p>
                    ) : null}
                  </div>
                )}
                {!row.assistantTurnInProgress && row.showAssistantCopyButton
                  ? veylenThreadCreationRecaps.map((creation) => (
                      <div key={creation.operationId} className="mt-2 mb-4">
                        <VeylenThreadCreationCard
                          creation={creation}
                          {...(onOpenThread
                            ? {
                                onOpenThread: (createdThreadId) =>
                                  onOpenThread(ThreadId.makeUnsafe(createdThreadId)),
                              }
                            : {})}
                        />
                      </div>
                    ))
                  : null}
                {(() => {
                  // Hold the end-of-turn changes card (Undo / Review) until the
                  // turn settles. While the turn is live the composer's own
                  // live-changes strip owns this surface; showing the card too
                  // would duplicate it and pre-empt the strip mid-turn.
                  if (!turnSummary || row.assistantTurnInProgress) return null;
                  const checkpointFiles = turnSummary.files;
                  if (checkpointFiles.length === 0) return null;
                  const fileChangesExpanded =
                    expandedFileChangesByTurnId[turnSummary.turnId] ?? true;
                  const fileListExpanded = expandedFileListByTurnId[turnSummary.turnId] ?? false;
                  const checkpointTurnCount = turnSummary.checkpointTurnCount;
                  const checkpointTurnCounts =
                    turnSummary.checkpointTurnCounts ??
                    (checkpointTurnCount === undefined ? [] : [checkpointTurnCount]);
                  const canUndo =
                    turnSummary.status !== "missing" &&
                    turnSummary.status !== "error" &&
                    turnSummary.checkpointRef !== undefined &&
                    !turnSummary.checkpointRef.startsWith("provider-diff:") &&
                    checkpointTurnCounts.length > 0 &&
                    onUndoTurnFiles !== undefined;
                  const totalAdditions = checkpointFiles.reduce(
                    (sum, file) => sum + (file.additions ?? 0),
                    0,
                  );
                  const totalDeletions = checkpointFiles.reduce(
                    (sum, file) => sum + (file.deletions ?? 0),
                    0,
                  );
                  const editedFilesLabel = `Edited ${checkpointFiles.length} ${pluralize(
                    checkpointFiles.length,
                    "file",
                  )}`;
                  const firstCheckpointFiles = checkpointFiles.slice(0, MAX_VISIBLE_CHANGED_FILES);
                  const overflowCheckpointFiles = checkpointFiles.slice(MAX_VISIBLE_CHANGED_FILES);
                  const renderCheckpointFileRow = (
                    file: (typeof checkpointFiles)[number],
                    withFirstReset: boolean,
                  ) => {
                    // Hoisted out of JSX: a `??` inside an `&&` test makes React Compiler
                    // bail out ("Unexpected terminal kind `logical` for logical test block").
                    const additions = file.additions ?? 0;
                    const deletions = file.deletions ?? 0;
                    const hasDiffStat = additions + deletions > 0;
                    return (
                      <button
                        key={file.path}
                        type="button"
                        className={cn(
                          "group/file-row flex w-full items-center gap-2 border-t border-[color:var(--color-border-light)] bg-transparent px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-background-button-secondary-hover)] dark:bg-transparent dark:hover:bg-transparent",
                          withFirstReset && "first:border-t-0",
                        )}
                        onClick={() => onOpenTurnDiff(turnSummary.turnId, file.path)}
                      >
                        <FileEntryIcon
                          pathValue={file.path}
                          kind="file"
                          theme={resolvedTheme}
                          colorMode="inherit"
                          className="size-4 shrink-0 text-[var(--color-text-foreground)] opacity-70 dark:opacity-80"
                        />
                        <span
                          className="font-system-ui truncate font-normal text-[var(--color-text-foreground)] underline-offset-2 group-hover/file-row:underline group-focus-visible/file-row:underline"
                          style={{ fontSize: chatTypographyStyle.fontSize }}
                        >
                          {file.path}
                        </span>
                        {hasDiffStat && (
                          <span
                            className="font-system-ui ml-auto shrink-0 tabular-nums"
                            style={{ fontSize: chatTypographyStyle.fontSize }}
                          >
                            <DiffStatLabel additions={additions} deletions={deletions} />
                          </span>
                        )}
                      </button>
                    );
                  };
                  return (
                    <div className="mt-1 mb-4 overflow-hidden rounded-[0.65rem] border border-[color:var(--color-border-light)] dark:border-[color:color-mix(in_srgb,var(--color-border-light)_55%,transparent)]">
                      <div
                        className={cn(
                          "flex items-center justify-between gap-3 bg-[color:color-mix(in_srgb,var(--app-user-message-background)_40%,transparent)] px-3 py-1.5",
                          fileChangesExpanded &&
                            "border-b border-[color:var(--color-border-light)]",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <ChangesIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
                          <div className="min-w-0">
                            <div
                              className="truncate font-normal text-foreground/92"
                              style={{ fontSize: chatTypographyStyle.fontSize }}
                            >
                              {editedFilesLabel}
                            </div>
                            {totalAdditions + totalDeletions > 0 ? (
                              <div
                                className="font-system-ui tabular-nums"
                                style={{ fontSize: chatTypographyStyle.fontSize }}
                              >
                                <DiffStatLabel
                                  additions={totalAdditions}
                                  deletions={totalDeletions}
                                />
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {canUndo && (
                            <button
                              type="button"
                              className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
                              style={{ fontSize: chatTypographyStyle.fontSize }}
                              onClick={() => onUndoTurnFiles(checkpointTurnCounts)}
                            >
                              Undo
                              <Undo2Icon className="size-3" />
                            </button>
                          )}
                          <ReviewChangesButton
                            style={{ fontSize: chatTypographyStyle.fontSize }}
                            onClick={() => onOpenTurnDiff(turnSummary.turnId)}
                          />
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground/80"
                            aria-expanded={fileChangesExpanded}
                            aria-label={
                              fileChangesExpanded
                                ? "Collapse changed files list"
                                : "Expand changed files list"
                            }
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (!fileChangesExpanded && isTailContentRow) {
                                scrollTailExpansionToEnd();
                              }
                              toggleFileChangesExpanded(turnSummary.turnId);
                            }}
                            data-scroll-anchor-ignore={isTailContentRow ? true : undefined}
                          >
                            <DisclosureChevron
                              open={fileChangesExpanded}
                              className="dark:text-muted-foreground/50"
                            />
                          </button>
                        </div>
                      </div>
                      <DisclosureRegion open={fileChangesExpanded}>
                        {firstCheckpointFiles.map((file) => renderCheckpointFileRow(file, true))}
                        {overflowCheckpointFiles.length > 0 ? (
                          <DisclosureRegion open={fileListExpanded}>
                            {overflowCheckpointFiles.map((file) =>
                              renderCheckpointFileRow(file, false),
                            )}
                          </DisclosureRegion>
                        ) : null}
                        {overflowCheckpointFiles.length > 0 ? (
                          <button
                            type="button"
                            className="flex w-full items-center justify-start gap-1.5 border-t border-[color:var(--color-border-light)] bg-transparent px-3 py-2 font-system-ui font-normal text-muted-foreground transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground"
                            style={{ fontSize: chatTypographyStyle.fontSize }}
                            aria-expanded={fileListExpanded}
                            onClick={() => toggleFileListExpanded(turnSummary.turnId)}
                          >
                            <DisclosureChevron open={fileListExpanded} />
                            <span>
                              {fileListExpanded
                                ? "Show less"
                                : `Show ${overflowCheckpointFiles.length} more ${pluralize(
                                    overflowCheckpointFiles.length,
                                    "file",
                                  )}`}
                            </span>
                          </button>
                        ) : null}
                      </DisclosureRegion>
                    </div>
                  );
                })()}
              </div>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            cwd={markdownCwd}
            workspaceRoot={workspaceRoot}
            chatTypographyStyle={chatTypographyStyle}
          />
        </div>
      )}

      {row.kind === "reasoning-status" && (
        <LiveReasoningStatusRow
          scopeKey={row.scopeKey}
          reasoningEntries={row.reasoningEntries}
          fontSize={chatTypographyStyle.fontSize}
        />
      )}

      {row.kind === "turn-activity" &&
        (() => {
          const detailItems = (row.collapsedTurnItems ?? []).filter(
            (item) => item.kind !== "work" || !item.entry.veylenThreadCreation,
          );
          const settleTransitionOpen = settleOpenByActivityId[row.id];
          // `true` = settle enter frame (full height, no enter motion).
          // `false` = settle close frame (shared disclosure close).
          // `undefined` = steady state; fall back to user toggle map.
          const expanded =
            row.state === "settled" && detailItems.length > 0
              ? settleTransitionOpen !== undefined
                ? settleTransitionOpen
                : (expandedCollapsedWork[row.id] ?? false)
              : false;
          const settleEnterInstant = settleTransitionOpen === true;
          const renderItem = (
            item: CollapsedTurnItem,
            keyPrefix: string,
            presentation: "default" | "summary-detail" = "default",
          ) =>
            item.kind === "work" ? (
              <TimelineWorkEntryRow
                key={`${keyPrefix}:work:${row.id}:${item.id}`}
                workEntry={item.entry}
                chatMetaFontSizePx={appTypographyScale.chatMetaPx}
                textFontSizePx={normalizedChatFontSizePx}
                density={prefersCompactWorkEntryRow(item.entry) ? "compact" : "default"}
                presentation={presentation}
                markdownCwd={markdownCwd}
                onImageExpand={onImageExpand}
                timestampFormat={timestampFormat}
                {...(onOpenAgentActivity ? { onOpenAgentActivity } : {})}
                {...(onOpenAutomation ? { onOpenAutomation } : {})}
                {...(onOpenThread ? { onOpenThread } : {})}
              />
            ) : (
              <div
                key={`${keyPrefix}:narration:${row.id}:${item.id}`}
                className="text-muted-foreground/80"
              >
                <ChatMarkdown
                  text={item.message.text}
                  cwd={markdownCwd}
                  isStreaming={false}
                  style={chatTypographyStyle}
                  onImageExpand={onImageExpand}
                />
              </div>
            );
          const renderChunk = (chunk: CollapsedTurnChunk) => {
            if (chunk.kind === "item") {
              return renderItem(chunk.item, "turn-activity");
            }
            const summary = summarizeToolCallGroup(chunk.entries);
            if (!summary) {
              return chunk.entries.map((entry) =>
                renderItem({ kind: "work", id: entry.id, entry }, "turn-activity"),
              );
            }
            const summaryKey = `turn:${row.id}:${chunk.id}`;
            return (
              <ToolCallGroupSummaryRow
                key={`turn-activity:tool-group:${row.id}:${chunk.id}`}
                summary={summary}
                open={toolGroupSummaryOverrides[summaryKey] ?? false}
                onToggle={(open) => setToolGroupSummaryOpen(summaryKey, open)}
                fontSizePx={normalizedChatFontSizePx}
                live={false}
                renderChildren={() => (
                  <div className="space-y-0.5 pt-0.5">
                    {chunk.entries.map((entry) =>
                      renderItem(
                        { kind: "work", id: entry.id, entry },
                        "turn-activity",
                        "summary-detail",
                      ),
                    )}
                  </div>
                )}
              />
            );
          };

          return (
            <TurnActivityRegion
              activityId={row.id}
              state={row.state}
              startedAt={row.createdAt}
              settledElapsed={row.collapsedWorkElapsed ?? null}
              {...(nowIso !== undefined ? { nowIso } : {})}
              open={expanded}
              settleEnterInstant={settleEnterInstant}
              settleTransitionActive={settleTransitionOpen !== undefined}
              hasDetails={detailItems.length > 0}
              fontSize={chatTypographyStyle.fontSize}
              onToggle={(open) => setCollapsedWorkExpanded(row.id, open)}
              renderChildren={() => (
                <div className="mb-2.5 space-y-1.5">
                  {chunkCollapsedTurnItems(detailItems).map(renderChunk)}
                </div>
              )}
            />
          );
        })()}

      {row.kind === "worktree-setup" && (
        <DisclosureRegion open={row.open}>
          <div className="pt-0.5 pb-1">
            <WorktreeSetupCard steps={row.steps} />
          </div>
        </DisclosureRegion>
      )}
      {row.kind === "message" &&
      forkSourceThreadId !== null &&
      forkBoundaryMessageId !== null &&
      row.message.id === forkBoundaryMessageId ? (
        <ForkContinuationDivider
          sourceThreadId={forkSourceThreadId}
          {...(onOpenThread ? { onOpenSourceThread: onOpenThread } : {})}
        />
      ) : null}
    </div>
  );

  // Transient rows (for example failed first-send worktree setup) must be able
  // to render even when there are no persisted chat messages yet.
  const hasRenderableTranscriptContent =
    hasMessages || rows.length > 0 || footerContent != null || canRenderForkSourceDivider;
  if (!hasRenderableTranscriptContent && !isWorking) {
    if (emptyStateContent) {
      return <div className="flex h-full items-center justify-center">{emptyStateContent}</div>;
    }
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <div ref={timelineRootRef} className="contents" data-messages-timeline-root="true">
      <LegendList<MessagesTimelineRow>
        ref={resolvedListRef}
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={({ item }) => renderRowContent(item)}
        estimatedItemSize={90}
        // Reserve only the newest turn pair so LegendList cannot recycle the live
        // follow-up's physical DOM before Working transitions to Worked.
        alwaysRender={alwaysRenderedTurnActivityRows}
        // LegendList caches rendered rows, so every local expansion map that changes row content
        // has to be surfaced through extraData.
        extraData={timelineExtraData}
        // Deliberately keyed off the *inherited* anchor rather than
        // `tailAnchorSlideInFlight`: LegendList re-targets the end on every data
        // change while this is true, which would yank a live post-send anchor
        // out of its hold. A remount that inherits an already-settled anchor has
        // no slide to preserve, so bootstrapping at the end is what we want.
        initialScrollAtEnd={activeTailAnchorMessageId === null || hasInheritedTailAnchor}
        {...(anchoredEndSpace ? { anchoredEndSpace } : {})}
        maintainScrollAtEnd={followLiveOutput && !tailAnchorSlideInFlight}
        maintainScrollAtEndThreshold={0.1}
        {...(activeTailAnchorMessageId !== null
          ? { maintainVisibleContentPosition: false }
          : !followLiveOutput
            ? { maintainVisibleContentPosition: true }
            : {})}
        onClickCapture={onMessagesClickCapture}
        onMouseUp={onMessagesMouseUp}
        onPointerCancel={onMessagesPointerCancel}
        onPointerDown={onMessagesPointerDown}
        onPointerUp={onMessagesPointerUp}
        onScroll={handleListScroll}
        {...(onTrailHighlightsChange
          ? {
              onViewableItemsChanged: handleViewableItemsChanged,
              viewabilityConfig: TRAIL_VIEWABILITY_CONFIG,
            }
          : {})}
        onTouchEnd={onMessagesTouchEnd}
        onTouchMove={onMessagesTouchMove}
        onTouchStart={onMessagesTouchStart}
        onWheel={onMessagesWheel}
        data-chat-scroll-container="true"
        ListFooterComponent={listFooter}
        // `scroll-fade-b` (vendored shadcn 4.12.0 util in index.css) masks the bottom
        // edge so streamed content dissolves toward the composer. It is scroll-aware
        // via `animation-timeline: scroll()`, so the fade clears at the live edge and a
        // pinned or non-scrollable transcript stays crisp (no permanent shadow).
        className={cn(
          "scroll-fade-b h-full overflow-x-hidden overscroll-y-contain py-3 [scrollbar-gutter:stable] sm:py-4",
          ENVIRONMENT_CONTENT_INSET_MOTION_CLASS,
          CHAT_COLUMN_GUTTER_CLASS_NAME,
        )}
        {...(listScrollStyle ? { style: listScrollStyle } : {})}
      />
    </div>
  );
});

type TimelineMessage = Extract<MessagesTimelineRow, { kind: "message" }>["message"];
// Reuse stable row references so streaming updates only force React work for
// rows whose visible content actually changed.
function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const previousStateRef = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => reconcileStableTimelineRows(rows, previousStateRef), [rows]);
}

// The reconciliation reads and rewrites the previous-state cache during the memo,
// which the compiler rejects. Keeping it in a module helper that takes the ref
// (module functions aren't compiled) preserves the per-row identity reuse: a
// whole-array useStableValue would drop every row reference whenever any single row
// changed, re-rendering the entire streaming transcript instead of just that row.
function reconcileStableTimelineRows(
  rows: MessagesTimelineRow[],
  previousStateRef: RefObject<StableMessagesTimelineRowsState>,
): MessagesTimelineRow[] {
  const nextState = computeStableMessagesTimelineRows(rows, previousStateRef.current);
  previousStateRef.current = nextState;
  return nextState.result;
}

// Animates only user rows that ChatView identifies as local optimistic sends;
// transcript hydration can add rows too, but should not replay send motion.
function useMessageSendEnterAnimations(
  rows: readonly MessagesTimelineRow[],
  enteringUserMessageIds: ReadonlySet<MessageId>,
): ReadonlySet<string> {
  const [enteringRowIds, setEnteringRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const previousRowIdsRef = useRef<ReadonlySet<string> | null>(null);
  const cleanupTimeoutsRef = useRef<number[]>([]);

  useLayoutEffect(() => {
    applyMessageSendEnterAnimation({
      rows,
      enteringUserMessageIds,
      previousRowIdsRef,
      cleanupTimeoutsRef,
      setEnteringRowIds,
    });
  }, [enteringUserMessageIds, rows]);

  useEffect(
    () => () => {
      for (const timeoutId of cleanupTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      cleanupTimeoutsRef.current = [];
    },
    [],
  );

  return enteringRowIds;
}

// The fresh-row detection compares against the previous layout pass and stamps the
// entering class before paint, so the send motion cannot flash. Running it from a
// module helper (which the compiler doesn't scan) keeps that synchronous setState
// out of the compiled hook without deferring it to a rAF/timeout that would paint a
// frame before the class lands.
function applyMessageSendEnterAnimation(params: {
  rows: readonly MessagesTimelineRow[];
  enteringUserMessageIds: ReadonlySet<MessageId>;
  previousRowIdsRef: RefObject<ReadonlySet<string> | null>;
  cleanupTimeoutsRef: RefObject<number[]>;
  setEnteringRowIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
}): void {
  const { rows, enteringUserMessageIds, previousRowIdsRef, cleanupTimeoutsRef, setEnteringRowIds } =
    params;
  const currentRowIds = new Set(rows.map((row) => row.id));
  const previousRowIds = previousRowIdsRef.current;
  previousRowIdsRef.current = currentRowIds;

  const freshUserRowIds = rows
    .filter(
      (row) =>
        row.kind === "message" &&
        row.message.role === "user" &&
        enteringUserMessageIds.has(row.message.id) &&
        (previousRowIds === null || !previousRowIds.has(row.id)),
    )
    .map((row) => row.id);
  if (freshUserRowIds.length === 0) {
    return;
  }

  setEnteringRowIds((current) => {
    const next = new Set(current);
    for (const rowId of freshUserRowIds) {
      next.add(rowId);
    }
    return next;
  });

  const cleanupTimeout = window.setTimeout(() => {
    cleanupTimeoutsRef.current = cleanupTimeoutsRef.current.filter((id) => id !== cleanupTimeout);
    setEnteringRowIds((current) => {
      const next = new Set(current);
      for (const rowId of freshUserRowIds) {
        next.delete(rowId);
      }
      return next.size === current.size ? current : next;
    });
  }, MESSAGE_SEND_ENTER_ANIMATION_MS + MESSAGE_SEND_ENTER_CLEANUP_BUFFER_MS);
  cleanupTimeoutsRef.current.push(cleanupTimeout);
}

interface WorktreeSetupPresentation {
  snapshot: WorktreeSetupSnapshot;
  open: boolean;
}

// Keeps the transient worktree-setup card mounted through one shared-disclosure
// close animation after ChatView clears the snapshot, mirroring
// useTurnActivitySettleTransitions' rAF-flip + delayed-cleanup shape.
function useWorktreeSetupPresentation(
  worktreeSetup: WorktreeSetupSnapshot | null,
): WorktreeSetupPresentation | null {
  const [presented, setPresented] = useState<WorktreeSetupPresentation | null>(null);
  const closeFrameRef = useRef<number | null>(null);
  const cleanupTimeoutRef = useRef<number | null>(null);

  const clearCloseTimers = useCallback(() => {
    if (closeFrameRef.current !== null) {
      window.cancelAnimationFrame(closeFrameRef.current);
      closeFrameRef.current = null;
    }
    if (cleanupTimeoutRef.current !== null) {
      window.clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    reconcileWorktreeSetupPresentation({
      worktreeSetup,
      presented,
      clearCloseTimers,
      closeFrameRef,
      cleanupTimeoutRef,
      setPresented,
    });
  }, [worktreeSetup, presented, clearCloseTimers]);

  useLayoutEffect(() => clearCloseTimers, [clearCloseTimers]);

  return presented;
}

// Opens synchronously so the card is mounted before paint, then hands the close off
// to a rAF-flip + delayed unmount. Isolated in a module helper (not compiled) so the
// synchronous open setState stays out of the compiled hook while its exact ordering
// against the close timers is preserved.
function reconcileWorktreeSetupPresentation(params: {
  worktreeSetup: WorktreeSetupSnapshot | null;
  presented: WorktreeSetupPresentation | null;
  clearCloseTimers: () => void;
  closeFrameRef: RefObject<number | null>;
  cleanupTimeoutRef: RefObject<number | null>;
  setPresented: Dispatch<SetStateAction<WorktreeSetupPresentation | null>>;
}): void {
  const {
    worktreeSetup,
    presented,
    clearCloseTimers,
    closeFrameRef,
    cleanupTimeoutRef,
    setPresented,
  } = params;
  if (worktreeSetup) {
    clearCloseTimers();
    setPresented((current) =>
      current?.open && current.snapshot === worktreeSetup
        ? current
        : { snapshot: worktreeSetup, open: true },
    );
    return;
  }
  if (!presented?.open || closeFrameRef.current !== null) {
    return;
  }
  closeFrameRef.current = window.requestAnimationFrame(() => {
    closeFrameRef.current = null;
    setPresented((current) => (current?.open ? { ...current, open: false } : current));
    cleanupTimeoutRef.current = window.setTimeout(() => {
      cleanupTimeoutRef.current = null;
      setPresented(null);
    }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
  });
}

function TurnActivityRegion(props: {
  activityId: string;
  state: "working" | "settled";
  startedAt: string | null;
  settledElapsed: string | null;
  nowIso?: string;
  open: boolean;
  // First settle paint: show folded details at full height with no enter motion,
  // so the following close can ease with the shared disclosure curve.
  settleEnterInstant?: boolean;
  // True for the whole open→close settle handoff (used by hydrate regression tests).
  settleTransitionActive?: boolean;
  hasDetails: boolean;
  fontSize: CSSProperties["fontSize"];
  onToggle: (open: boolean) => void;
  renderChildren: () => ReactNode;
}) {
  const live = props.state === "working";
  const detailsOpen = !live && props.open;
  const settleEnterInstant = props.settleEnterInstant === true;
  const [keepChildrenMounted, setKeepChildrenMounted] = useState(detailsOpen);
  // Chevron fades in on the settle frame rather than popping with the label swap.
  const [chevronVisible, setChevronVisible] = useState(!live && props.hasDetails);

  useEffect(() => {
    if (detailsOpen) {
      setKeepChildrenMounted(true);
      return;
    }
    if (!keepChildrenMounted) return;
    const cleanup = window.setTimeout(
      () => setKeepChildrenMounted(false),
      DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS,
    );
    return () => window.clearTimeout(cleanup);
  }, [detailsOpen, keepChildrenMounted]);

  useEffect(() => {
    if (live || !props.hasDetails) {
      setChevronVisible(false);
      return;
    }
    setChevronVisible(false);
    const frame = window.requestAnimationFrame(() => {
      setChevronVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [live, props.hasDetails]);

  // Keep process content mounted whenever details exist so expand is instant
  // and closed markup still carries the tool/narration tree (ChatGPT keeps the
  // folded process in the disclosure, collapsed by default).
  const showDetails = props.hasDetails && (detailsOpen || keepChildrenMounted || !live);
  // Shared disclosure shell (not CollapsiblePanel): settle enter must paint at
  // full height without data-starting-style h-0, otherwise process flashes open
  // from zero before the close animation runs.
  const detailsShellClassName = cn(
    DISCLOSURE_SHELL_MOTION_CLASS,
    detailsOpen ? DISCLOSURE_SHELL_OPEN_CLASS : DISCLOSURE_SHELL_CLOSED_CLASS,
    settleEnterInstant && "transition-none",
  );
  const detailsContentClassName = cn(
    DISCLOSURE_CONTENT_MOTION_CLASS,
    detailsOpen ? DISCLOSURE_CONTENT_OPEN_CLASS : DISCLOSURE_CONTENT_CLOSED_CLASS,
    settleEnterInstant && "transition-none",
  );

  return (
    <div
      className="mb-3"
      data-turn-work-region={props.activityId}
      data-settled-turn-collapse-transition={props.settleTransitionActive ? "true" : undefined}
    >
      <div className="group/collapsed-work">
        <button
          type="button"
          disabled={live || !props.hasDetails}
          // No-tool settled turns have no details to expand; keep aria-expanded="false"
          // so assistive tech and tests still see a settled, non-expandable control.
          aria-expanded={live ? undefined : props.hasDetails ? detailsOpen : false}
          className="-ml-0.5 flex w-fit items-center gap-1 pb-2 text-left text-muted-foreground/70 transition-colors duration-200 hover:text-muted-foreground/90 disabled:pointer-events-none"
          style={{ fontSize: props.fontSize }}
          onClick={() => {
            if (live || !props.hasDetails) return;
            props.onToggle(!detailsOpen);
          }}
        >
          <TurnWorkRegionLabel
            state={props.state}
            startedAt={props.startedAt}
            settledElapsed={props.settledElapsed}
            {...(props.nowIso !== undefined ? { nowIso: props.nowIso } : {})}
          />
          {!live && props.hasDetails ? (
            <span
              className={cn(
                "work-status-chevron inline-flex",
                chevronVisible && "work-status-chevron--visible",
              )}
              aria-hidden={!chevronVisible}
            >
              <DisclosureChevron open={detailsOpen} className="text-muted-foreground/55" />
            </span>
          ) : null}
        </button>
        <div
          className={detailsShellClassName}
          data-turn-work-details={detailsOpen ? "open" : "closed"}
        >
          <div className={DISCLOSURE_INNER_CLASS}>
            {showDetails ? (
              <div className={detailsContentClassName}>{props.renderChildren()}</div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="h-px w-full bg-border" />
    </div>
  );
}

function LiveReasoningStatusRow(props: {
  scopeKey: string;
  reasoningEntries: ReadonlyArray<WorkLogEntry>;
  fontSize: CSSProperties["fontSize"];
}) {
  const providerPhrase = useMemo(() => {
    for (let index = props.reasoningEntries.length - 1; index >= 0; index -= 1) {
      const phrase = formatAgentActivityEntryPreview(props.reasoningEntries[index]!);
      if (phrase) return phrase;
    }
    return null;
  }, [props.reasoningEntries]);

  return (
    <div
      data-turn-thinking="true"
      className="text-muted-foreground/70"
      style={{ fontSize: props.fontSize }}
    >
      <ReasoningTextSwap active scopeKey={props.scopeKey} providerPhrase={providerPhrase} />
    </div>
  );
}

function TurnWorkRegionLabel(props: {
  state: "working" | "settled";
  startedAt: string | null;
  settledElapsed: string | null;
  nowIso?: string;
}) {
  const live = props.state === "working";
  const [liveElapsedSnapshot, setLiveElapsedSnapshot] = useState<WorkingElapsedSnapshot>({
    seconds: 0,
    label: "0s",
  });
  // Freeze the last live tick across settle. On settle the row's `startedAt` can
  // rewrite to the folded-segment start, so recalculating from props would jump.
  const frozenLiveElapsedRef = useRef<WorkingElapsedSnapshot | null>(null);
  const lastLiveStartedAtRef = useRef<string | null>(null);
  if (live && props.startedAt !== lastLiveStartedAtRef.current) {
    lastLiveStartedAtRef.current = props.startedAt;
    frozenLiveElapsedRef.current = null;
  }
  const fixedLiveElapsed =
    live && props.startedAt && props.nowIso
      ? readWorkingElapsedSnapshot(props.startedAt, props.nowIso)
      : null;

  useEffect(() => {
    if (!live || !props.startedAt) return;
    const updateElapsed = () => {
      const next = readWorkingElapsedSnapshot(
        props.startedAt!,
        props.nowIso ?? new Date().toISOString(),
      );
      setLiveElapsedSnapshot(next);
      frozenLiveElapsedRef.current = next;
    };
    // Reset snapshot immediately when origin changes so the first paint is 0s / bare Working.
    setLiveElapsedSnapshot({ seconds: 0, label: "0s" });
    updateElapsed();
    if (props.nowIso !== undefined) return;
    const intervalId = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(intervalId);
  }, [live, props.nowIso, props.startedAt]);

  const frozenLive = frozenLiveElapsedRef.current;
  const continuousLiveLabel =
    fixedLiveElapsed?.label ?? liveElapsedSnapshot.label ?? frozenLive?.label ?? "0s";
  const continuousLiveSeconds =
    fixedLiveElapsed?.seconds ?? liveElapsedSnapshot.seconds ?? frozenLive?.seconds ?? 0;
  const providerSettledElapsed = props.settledElapsed;
  const providerSettledSeconds =
    providerSettledElapsed != null ? parseClockDurationSeconds(providerSettledElapsed) : null;
  // Prefer continuous clock when provider elapsed is missing or behind the last
  // tick (early Worked-for while the turn is still open has no fixed end).
  const settledElapsed =
    providerSettledSeconds !== null && providerSettledSeconds >= continuousLiveSeconds
      ? providerSettledElapsed!
      : continuousLiveLabel;
  // Exiting Working layer keeps the same duration as the entering Worked layer.
  const workingElapsed = props.startedAt ? (live ? continuousLiveLabel : settledElapsed) : null;

  // Early Worked-for (tools done, answer streaming) still has startedAt and
  // needs a live tick even though state is "settled".
  const needsSettledClock = !live && props.startedAt != null && providerSettledElapsed == null;
  useEffect(() => {
    if (!needsSettledClock) return;
    const intervalId = window.setInterval(() => {
      setLiveElapsedSnapshot(
        readWorkingElapsedSnapshot(props.startedAt!, new Date().toISOString()),
      );
    }, 1_000);
    return () => window.clearInterval(intervalId);
  }, [needsSettledClock, props.startedAt]);

  return (
    <span className="inline-grid overflow-hidden" aria-live="polite">
      <span
        data-work-status-text="working"
        className={cn(
          "work-status-swap__phrase [grid-area:1/1]",
          live ? "work-status-swap__phrase--visible" : "work-status-swap__phrase--exit",
        )}
        aria-hidden={!live}
      >
        <CadencedShimmer active={live}>
          {/* ChatGPT: bare "Working" until 1s, then "Working for {time}". */}
          {props.startedAt && continuousLiveSeconds >= 1 ? (
            <>Working for {workingElapsed}</>
          ) : (
            "Working"
          )}
        </CadencedShimmer>
      </span>
      <span
        data-work-status-text="settled"
        className={cn(
          "work-status-swap__phrase [grid-area:1/1]",
          live ? "work-status-swap__phrase--enter" : "work-status-swap__phrase--visible",
        )}
        aria-hidden={live}
      >
        Worked for {settledElapsed}
      </span>
    </span>
  );
}

interface TurnActivitySettleTimer {
  closeFrame: number | null;
  cleanupTimeout: number | null;
}

// ChatGPT defaultExpanded=false: settled Worked-for stays collapsed. We only
// track settle transitions for cleanup of stale open flags — never auto-open.
function useTurnActivitySettleTransitions(
  rows: readonly MessagesTimelineRow[],
): Readonly<Record<string, boolean>> {
  const [openByActivityId, setOpenByActivityId] = useState<Record<string, boolean>>({});
  const previousActivityIdsRef = useRef<ReadonlySet<string>>(new Set());
  const previousSettledSignaturesRef = useRef<ReadonlyMap<string, string>>(new Map());
  const watchedLiveActivityIdsRef = useRef(new Set<string>());
  const timersRef = useRef(new Map<string, TurnActivitySettleTimer>());
  const startedThisRenderRef = useRef<string[]>([]);

  const clearTransitionTimer = useCallback((activityId: string) => {
    const timer = timersRef.current.get(activityId);
    if (!timer) {
      return;
    }
    if (timer.closeFrame !== null) {
      window.cancelAnimationFrame(timer.closeFrame);
    }
    if (timer.cleanupTimeout !== null) {
      window.clearTimeout(timer.cleanupTimeout);
    }
    timersRef.current.delete(activityId);
  }, []);

  const scheduleTransitionClose = useCallback(
    (activityId: string) => {
      clearTransitionTimer(activityId);
      const closeFrame = window.requestAnimationFrame(() => {
        const timer = timersRef.current.get(activityId);
        if (!timer) {
          return;
        }
        timersRef.current.set(activityId, { ...timer, closeFrame: null });
        setOpenByActivityId((current) => {
          if (current[activityId] !== true) {
            return current;
          }
          return { ...current, [activityId]: false };
        });

        const cleanupTimeout = window.setTimeout(() => {
          timersRef.current.delete(activityId);
          setOpenByActivityId((current) => {
            if (!(activityId in current)) {
              return current;
            }
            const next = { ...current };
            delete next[activityId];
            return next;
          });
        }, DISCLOSURE_TRANSITION_MS + DISCLOSURE_CLEANUP_BUFFER_MS);
        timersRef.current.set(activityId, { closeFrame: null, cleanupTimeout });
      });
      timersRef.current.set(activityId, { closeFrame, cleanupTimeout: null });
    },
    [clearTransitionTimer],
  );

  const detection = detectTurnActivitySettleTransitions({
    rows,
    previousActivityIds: previousActivityIdsRef.current,
    previousSettledSignatures: previousSettledSignaturesRef.current,
    watchedLiveActivityIds: watchedLiveActivityIdsRef.current,
    alreadyTransitioning: openByActivityId,
  });
  // Do not auto-open on settle (ChatGPT stays collapsed until click).
  startedThisRenderRef.current = [];
  const detectionRef = useRef(detection);
  detectionRef.current = detection;

  const mergedOpenByActivityId = openByActivityId;

  useLayoutEffect(() => {
    const currentDetection = detectionRef.current;
    previousActivityIdsRef.current = currentDetection.currentActivityIds;
    previousSettledSignaturesRef.current = currentDetection.currentSettledSignatures;
    watchedLiveActivityIdsRef.current = currentDetection.nextWatchedLiveActivityIds;

    const startedActivityIds = startedThisRenderRef.current;
    if (startedActivityIds.length === 0) {
      setOpenByActivityId((current) => {
        let next: Record<string, boolean> | null = null;
        for (const activityId of Object.keys(current)) {
          if (
            !currentDetection.currentSettledSignatures.has(activityId) &&
            !currentDetection.nextWatchedLiveActivityIds.has(activityId)
          ) {
            clearTransitionTimer(activityId);
            if (next === null) next = { ...current };
            delete next[activityId];
          }
        }
        return next ?? current;
      });
      return;
    }

    setOpenByActivityId((current) => {
      const next = { ...current };
      for (const activityId of startedActivityIds) {
        next[activityId] = true;
      }
      return next;
    });
    for (const activityId of startedActivityIds) {
      scheduleTransitionClose(activityId);
    }
  }, [clearTransitionTimer, rows, scheduleTransitionClose]);

  useEffect(
    () => () => {
      for (const activityId of Array.from(timersRef.current.keys())) {
        clearTransitionTimer(activityId);
      }
    },
    [clearTransitionTimer],
  );

  return mergedOpenByActivityId;
}

function detectTurnActivitySettleTransitions(params: {
  rows: readonly MessagesTimelineRow[];
  previousActivityIds: ReadonlySet<string>;
  previousSettledSignatures: ReadonlyMap<string, string>;
  watchedLiveActivityIds: ReadonlySet<string>;
  alreadyTransitioning: Readonly<Record<string, boolean>>;
}): {
  currentActivityIds: Set<string>;
  currentSettledSignatures: Map<string, string>;
  nextWatchedLiveActivityIds: Set<string>;
  startedActivityIds: string[];
} {
  const currentActivityIds = new Set<string>();
  const currentSettledSignatures = new Map<string, string>();
  const currentSettledActivityIds = new Set<string>();
  const nextWatchedLiveActivityIds = new Set(params.watchedLiveActivityIds);
  const startedActivityIds: string[] = [];

  for (const row of params.rows) {
    if (row.kind !== "turn-activity") {
      continue;
    }
    currentActivityIds.add(row.id);
    if (row.state === "working") {
      nextWatchedLiveActivityIds.add(row.id);
    }
    if (row.state === "settled") {
      currentSettledActivityIds.add(row.id);
    }
    const detailCount = row.collapsedTurnItems?.length ?? 0;
    if (row.state === "settled" && detailCount > 0) {
      currentSettledSignatures.set(row.id, collapsedTurnItemsSignature(row.collapsedTurnItems!));
    }
  }

  for (const activityId of Array.from(nextWatchedLiveActivityIds)) {
    if (!currentActivityIds.has(activityId)) {
      nextWatchedLiveActivityIds.delete(activityId);
    }
  }

  for (const activityId of currentSettledSignatures.keys()) {
    if (
      nextWatchedLiveActivityIds.has(activityId) &&
      params.previousActivityIds.has(activityId) &&
      !params.previousSettledSignatures.has(activityId) &&
      params.alreadyTransitioning[activityId] === undefined
    ) {
      startedActivityIds.push(activityId);
    }
  }

  for (const activityId of currentSettledActivityIds) {
    nextWatchedLiveActivityIds.delete(activityId);
  }

  return {
    currentActivityIds,
    currentSettledSignatures,
    nextWatchedLiveActivityIds,
    startedActivityIds,
  };
}

function collapsedTurnItemsSignature(items: readonly CollapsedTurnItem[]): string {
  return items.map((item) => `${item.kind}:${item.id}`).join("|");
}

// Keep the live clock scoped to the tiny status-label leaf so active Claude turns
// not force the full transcript tree to re-render every second.
type WorkingElapsedSnapshot = { seconds: number; label: string };

function readWorkingElapsedSnapshot(startIso: string, endIso: string): WorkingElapsedSnapshot {
  const startedAt = Date.parse(startIso);
  const endedAt = Date.parse(endIso);
  const seconds =
    Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt
      ? 0
      : Math.floor((endedAt - startedAt) / 1_000);
  return {
    seconds,
    label: formatClockElapsed(startIso, endIso) ?? "0s",
  };
}

function parseClockDurationSeconds(label: string): number | null {
  const hours = label.match(/([\d.]+)h/)?.[1];
  const minutes = label.match(/([\d.]+)m/)?.[1];
  const seconds = label.match(/([\d.]+)s/)?.[1];
  if (!hours && !minutes && !seconds) return null;
  return Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

const UserImageAttachmentThumbnail = memo(function UserImageAttachmentThumbnail(props: {
  image: Extract<NonNullable<TimelineMessage["attachments"]>[number], { type: "image" }>;
  userImages: Array<
    Extract<NonNullable<TimelineMessage["attachments"]>[number], { type: "image" }>
  >;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  onTimelineImageLoad: () => void;
  resolvedTheme: "light" | "dark";
}) {
  return (
    <button
      type="button"
      className="flex size-15 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/70 bg-background/82 text-left shadow-[0_1px_0_rgba(255,255,255,0.2)_inset] transition-colors hover:bg-background/94"
      aria-label={`Preview ${props.image.name}`}
      title={props.image.name}
      onClick={() => {
        const preview = buildExpandedImagePreview(props.userImages, props.image.id);
        if (!preview) return;
        props.onImageExpand(preview);
      }}
    >
      {props.image.previewUrl ? (
        <img
          src={props.image.previewUrl}
          alt={props.image.name}
          className="size-full object-cover"
          onLoad={props.onTimelineImageLoad}
          onError={props.onTimelineImageLoad}
        />
      ) : (
        <div className="flex size-full items-center justify-center">
          <FileEntryIcon
            pathValue={props.image.name}
            kind="file"
            theme={props.resolvedTheme}
            className="size-4 opacity-70"
          />
        </div>
      )}
    </button>
  );
});

// Renders read-only user text with the same inline skill pill treatment as the composer.
function renderUserMessageInlineText(
  text: string,
  keyPrefix: string,
  resolvedTheme: "light" | "dark",
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
): ReactNode[] {
  return splitPromptIntoDisplaySegments(text, mentionReferences).flatMap((segment, index) => {
    const key = `${keyPrefix}:${index}`;
    if (segment.type === "text") {
      return segment.text.length > 0 ? [<span key={`${key}:text`}>{segment.text}</span>] : [];
    }
    if (segment.type === "skill") {
      return [<InlineSkillChip key={`${key}:skill`} skillName={segment.name} />];
    }
    if (segment.type === "mention") {
      return [
        <InlineMentionChip
          key={`${key}:mention`}
          path={segment.path}
          theme={resolvedTheme}
          mentionReferences={mentionReferences}
          {...(segment.kind ? { kind: segment.kind } : {})}
        />,
      ];
    }
    if (segment.type === "agent-mention") {
      return [<InlineAgentChip key={`${key}:agent`} alias={segment.alias} color={segment.color} />];
    }
    if (segment.type === "link") {
      return [<InlineLinkChip key={`${key}:link`} url={segment.url} interactive />];
    }
    return [];
  });
}

function hasOnlyInlineSkillChips(
  text: string,
  mentionReferences: ReadonlyArray<ProviderMentionReference> = [],
): boolean {
  const segments = splitPromptIntoDisplaySegments(text, mentionReferences);
  let skillCount = 0;

  for (const segment of segments) {
    if (segment.type === "skill") {
      skillCount += 1;
      continue;
    }
    if (segment.type === "text" && segment.text.trim().length === 0) {
      continue;
    }
    return false;
  }

  return skillCount > 0;
}

// Inline editor for replaying a user message after the following assistant turn is rolled back.
const UserMessageEditForm = memo(function UserMessageEditForm(props: {
  initialValue: string;
  disabled: boolean;
  allowEmpty: boolean;
  chatTypographyStyle: CSSProperties;
  borderClassName: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(props.initialValue);
  const canSubmit = canSubmitUserMessageEdit({
    draft,
    allowEmpty: props.allowEmpty,
    disabled: props.disabled,
  });

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [draft]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSubmit) {
        props.onSubmit(draft);
      }
    }
  };

  return (
    <form
      className={cn(
        "w-full bg-[var(--app-user-message-background)]",
        USER_MESSAGE_BUBBLE_RADIUS_CLASS_NAME,
        props.borderClassName,
        USER_MESSAGE_BUBBLE_SHELL_CHROME_CLASS_NAME,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          props.onSubmit(draft);
        }
      }}
    >
      <textarea
        ref={textareaRef}
        value={draft}
        disabled={props.disabled}
        rows={1}
        aria-label="Edit message"
        className="max-h-60 min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent p-0 font-system-ui text-foreground outline-none placeholder:text-muted-foreground/45 disabled:opacity-70"
        style={props.chatTypographyStyle}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="rounded-full px-2.5"
          style={props.chatTypographyStyle}
          disabled={props.disabled}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="xs"
          className="rounded-full px-2.5"
          style={props.chatTypographyStyle}
          disabled={!canSubmit}
        >
          Send
        </Button>
      </div>
    </form>
  );
});

// Measures the clamped message against its content before paint so the fade mask
// never flickers. Kept in a module helper (not compiled) so the synchronous
// overflow setState — unavoidable for a layout measurement — stays out of the
// compiled component.
function measureUserMessageOverflow(
  collapsed: boolean,
  contentRef: RefObject<HTMLDivElement | null>,
  setOverflowing: (overflowing: boolean) => void,
): (() => void) | undefined {
  if (!collapsed) {
    return undefined;
  }
  const element = contentRef.current;
  if (!element) {
    return undefined;
  }
  const measure = () => {
    setOverflowing(element.scrollHeight - element.clientHeight > 1);
  };
  measure();
  return observeUserMessageOverflow(element, measure);
}

// Show more/less for long user messages: a visual max-height clamp (with a fade
// mask) around the fully rendered message instead of the old character slice.
const UserMessageCollapsibleText = memo(function UserMessageCollapsibleText(props: {
  text: string;
  expanded: boolean;
  chatFontSizePx: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const [overflowing, setOverflowing] = useState(() => userMessageLikelyOverflows(props.text));
  const collapsed = !props.expanded;

  useLayoutEffect(
    () => measureUserMessageOverflow(collapsed, contentRef, setOverflowing),
    [collapsed, props.text],
  );

  const lineHeightPx = getChatTranscriptUserMessageLineHeightPx(props.chatFontSizePx);
  const clampHeightPx = USER_MESSAGE_COLLAPSED_MAX_LINES * lineHeightPx;
  const fadeStartPx = clampHeightPx - USER_MESSAGE_COLLAPSED_FADE_LINES * lineHeightPx;
  const clamped = collapsed && overflowing;

  return (
    <>
      <div
        id={contentId}
        ref={contentRef}
        data-user-message-clamp={clamped ? "true" : "false"}
        className={cn("min-w-0", collapsed && "overflow-hidden")}
        style={
          collapsed
            ? {
                maxHeight: `${clampHeightPx}px`,
                ...(clamped
                  ? {
                      maskImage: `linear-gradient(to bottom, black ${fadeStartPx}px, transparent 100%)`,
                    }
                  : {}),
              }
            : undefined
        }
      >
        {props.children}
      </div>
      {(clamped || props.expanded) && (
        <button
          type="button"
          data-scroll-anchor-ignore
          className="mt-1 block text-muted-foreground/55 transition-colors duration-150 hover:text-foreground/72"
          style={{ fontSize: `${props.chatFontSizePx}px` }}
          aria-expanded={props.expanded}
          aria-controls={contentId}
          onClick={props.onToggle}
        >
          {props.expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
});

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  mentionReferences: ReadonlyArray<ProviderMentionReference>;
  terminalContexts: ParsedTerminalContextEntry[];
  chatTypographyStyle: CSSProperties;
  resolvedTheme: "light" | "dark";
  markdownCwd: string | undefined;
}) {
  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const markdownText = hasEmbeddedInlineLabels
      ? props.text
      : [inlinePrefix, props.text].filter((part) => part.length > 0).join(" ");
    if (markdownText.length === 0) {
      return null;
    }
    return (
      <ChatMarkdown
        text={markdownText}
        cwd={props.markdownCwd}
        variant="user"
        mentionReferences={props.mentionReferences}
        terminalContexts={props.terminalContexts}
        className="font-system-ui wrap-break-word"
        style={props.chatTypographyStyle}
      />
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  if (
    props.terminalContexts.length === 0 &&
    hasOnlyInlineSkillChips(props.text, props.mentionReferences)
  ) {
    return (
      <div
        className="flex max-w-full min-w-0 items-center leading-none text-foreground [&>span]:translate-y-0"
        style={props.chatTypographyStyle}
      >
        {renderUserMessageInlineText(
          props.text,
          "user-message-inline-chip-only",
          props.resolvedTheme,
          props.mentionReferences,
        )}
      </div>
    );
  }

  // Plain sent text renders as markdown (same pipeline as assistant messages);
  // the user variant keeps single newlines, skips math, and renders composer
  // tokens as chips via the composer-chips remark plugin.
  return (
    <ChatMarkdown
      variant="user"
      text={props.text}
      cwd={props.markdownCwd}
      isStreaming={false}
      mentionReferences={props.mentionReferences}
      className="font-system-ui"
      style={props.chatTypographyStyle}
    />
  );
});
