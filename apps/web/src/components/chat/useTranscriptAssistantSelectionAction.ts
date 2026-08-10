// FILE: useTranscriptAssistantSelectionAction.ts
// Purpose: Own the assistant highlight -> floating action -> composer insertion flow for transcript selections.
// Layer: Chat transcript interaction controller

import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@synara/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type MouseEventHandler,
  type PointerEventHandler,
  type TouchEventHandler,
  type WheelEventHandler,
} from "react";
import { toastManager } from "../ui/toast";
import { type ComposerAssistantSelectionAttachment } from "../../composerDraftStore";
import {
  createAssistantSelectionAttachment,
  getAssistantSelectionValidationError,
} from "../../lib/assistantSelections";
import {
  readTranscriptAssistantSelection,
  resolveTranscriptSelectionActionLayout,
  type TranscriptAssistantSelection,
} from "./chatSelectionActions";

export interface PendingTranscriptSelectionAction {
  selection: TranscriptAssistantSelection;
  left: number;
  top: number;
  placement: "top" | "bottom";
}

interface UseTranscriptAssistantSelectionActionOptions {
  threadId: string;
  enabled: boolean;
  composerImagesRef: MutableRefObject<ReadonlyArray<unknown>>;
  composerFilesRef: MutableRefObject<ReadonlyArray<unknown>>;
  composerAssistantSelectionsRef: MutableRefObject<
    ReadonlyArray<ComposerAssistantSelectionAttachment>
  >;
  addComposerAssistantSelectionToDraft: (
    selection: ComposerAssistantSelectionAttachment,
  ) => boolean;
  canReferenceAssistantSelection?: (selection: TranscriptAssistantSelection) => boolean;
  scheduleComposerFocus: () => void;
  onMessagesClickCaptureBase: MouseEventHandler<HTMLDivElement>;
  onMessagesPointerDownBase: PointerEventHandler<HTMLDivElement>;
  onMessagesPointerUpBase: PointerEventHandler<HTMLDivElement>;
  onMessagesPointerCancelBase: PointerEventHandler<HTMLDivElement>;
  onMessagesScrollBase: () => void;
  onMessagesWheelBase: WheelEventHandler<HTMLDivElement>;
  onMessagesTouchStartBase: TouchEventHandler<HTMLDivElement>;
  onMessagesTouchMoveBase: TouchEventHandler<HTMLDivElement>;
  onMessagesTouchEndBase: TouchEventHandler<HTMLDivElement>;
}

export function useTranscriptAssistantSelectionAction(
  options: UseTranscriptAssistantSelectionActionOptions,
) {
  const {
    threadId,
    enabled,
    composerImagesRef,
    composerFilesRef,
    composerAssistantSelectionsRef,
    addComposerAssistantSelectionToDraft,
    canReferenceAssistantSelection,
    scheduleComposerFocus,
    onMessagesClickCaptureBase,
    onMessagesPointerDownBase,
    onMessagesPointerUpBase,
    onMessagesPointerCancelBase,
    onMessagesScrollBase,
    onMessagesWheelBase,
    onMessagesTouchStartBase,
    onMessagesTouchMoveBase,
    onMessagesTouchEndBase,
  } = options;
  // Pending action keyed to its thread: a thread switch or disable derives
  // straight back to null with no state-resetting effects. The setter reads
  // the current thread from a ref so empty-deps callbacks never go stale.
  const [pendingActionState, setPendingActionState] = useState<{
    threadId: typeof threadId;
    action: PendingTranscriptSelectionAction;
  } | null>(null);
  const pendingActionThreadIdRef = useRef(threadId);
  useEffect(() => {
    pendingActionThreadIdRef.current = threadId;
  }, [threadId]);
  const pendingTranscriptSelectionAction =
    enabled && pendingActionState !== null && pendingActionState.threadId === threadId
      ? pendingActionState.action
      : null;
  const setPendingTranscriptSelectionAction = useCallback(
    (action: PendingTranscriptSelectionAction | null) =>
      setPendingActionState(
        action === null ? null : { threadId: pendingActionThreadIdRef.current, action },
      ),
    [],
  );

  const dismissTranscriptSelectionAction = useCallback(() => {
    setPendingTranscriptSelectionAction(null);
  }, [setPendingTranscriptSelectionAction]);

  const onMessagesClickCapture: MouseEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesClickCaptureBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesClickCaptureBase],
  );

  const onMessagesPointerDown: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesPointerDownBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesPointerDownBase],
  );

  const onMessagesPointerUp: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      onMessagesPointerUpBase(event);
    },
    [onMessagesPointerUpBase],
  );

  const onMessagesPointerCancel: PointerEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesPointerCancelBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesPointerCancelBase],
  );

  const onMessagesScroll = useCallback(() => {
    dismissTranscriptSelectionAction();
    onMessagesScrollBase();
  }, [dismissTranscriptSelectionAction, onMessagesScrollBase]);

  const onMessagesWheel: WheelEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesWheelBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesWheelBase],
  );

  const onMessagesTouchStart: TouchEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesTouchStartBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesTouchStartBase],
  );

  const onMessagesTouchMove: TouchEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      dismissTranscriptSelectionAction();
      onMessagesTouchMoveBase(event);
    },
    [dismissTranscriptSelectionAction, onMessagesTouchMoveBase],
  );

  const onMessagesTouchEnd: TouchEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      onMessagesTouchEndBase(event);
    },
    [onMessagesTouchEndBase],
  );

  const onMessagesMouseUp: MouseEventHandler<HTMLDivElement> = useCallback(
    (event) => {
      const container = event.currentTarget;
      const clientX = event.clientX;
      const clientY = event.clientY;
      window.requestAnimationFrame(() => {
        if (!enabled || !container) {
          setPendingTranscriptSelectionAction(null);
          return;
        }

        const selectionState = readTranscriptAssistantSelection({ container });
        if (
          !selectionState ||
          (canReferenceAssistantSelection &&
            !canReferenceAssistantSelection(selectionState.selection))
        ) {
          setPendingTranscriptSelectionAction(null);
          return;
        }

        const layout = resolveTranscriptSelectionActionLayout({
          selectionRect: selectionState.selectionRect,
          pointer: { x: clientX, y: clientY },
        });
        setPendingTranscriptSelectionAction({
          selection: selectionState.selection,
          left: layout.left,
          top: layout.top,
          placement: layout.placement,
        });
      });
    },
    [canReferenceAssistantSelection, enabled, setPendingTranscriptSelectionAction],
  );

  const commitTranscriptAssistantSelection = useCallback(() => {
    const pendingSelection = pendingTranscriptSelectionAction;
    if (!pendingSelection) {
      return;
    }

    if (
      canReferenceAssistantSelection &&
      !canReferenceAssistantSelection(pendingSelection.selection)
    ) {
      setPendingTranscriptSelectionAction(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    if (
      composerImagesRef.current.length +
        composerFilesRef.current.length +
        composerAssistantSelectionsRef.current.length >=
      PROVIDER_SEND_TURN_MAX_ATTACHMENTS
    ) {
      setPendingTranscriptSelectionAction(null);
      toastManager.add({
        type: "warning",
        title: `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} references per message.`,
      });
      return;
    }

    const nextSelection = createAssistantSelectionAttachment(pendingSelection.selection);
    if (!nextSelection) {
      setPendingTranscriptSelectionAction(null);
      if (getAssistantSelectionValidationError(pendingSelection.selection) === "too-long") {
        toastManager.add({
          type: "warning",
          title: "Selections can be up to 4,000 characters.",
        });
      }
      return;
    }

    const inserted = addComposerAssistantSelectionToDraft(nextSelection);
    setPendingTranscriptSelectionAction(null);
    if (inserted) {
      window.getSelection()?.removeAllRanges();
      scheduleComposerFocus();
    }
  }, [
    addComposerAssistantSelectionToDraft,
    canReferenceAssistantSelection,
    composerAssistantSelectionsRef,
    composerFilesRef,
    composerImagesRef,
    pendingTranscriptSelectionAction,
    scheduleComposerFocus,
    setPendingTranscriptSelectionAction,
  ]);

  useEffect(() => {
    if (!pendingTranscriptSelectionAction) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-transcript-selection-action='true']")
      ) {
        return;
      }
      setPendingTranscriptSelectionAction(null);
    };
    const handleWindowChange = () => {
      setPendingTranscriptSelectionAction(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    document.addEventListener("selectionchange", handleWindowChange);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      document.removeEventListener("selectionchange", handleWindowChange);
    };
  }, [pendingTranscriptSelectionAction]);

  return {
    pendingTranscriptSelectionAction,
    commitTranscriptAssistantSelection,
    dismissTranscriptSelectionAction,
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
  };
}
