// FILE: MessageForkButton.tsx
// Purpose: Assistant-footer fork control — Local / Worktree menu; forks and navigates immediately.
// Layer: Web chat presentation component
// Exports: MessageForkButton

import { useRef, useState } from "react";

import { ChatBranchIcon, DeviceLaptopIcon, WorktreeIcon } from "~/lib/icons";
import { cn } from "~/lib/utils";
import { Menu, MenuItem, MenuTrigger } from "../ui/menu";
import { anchoredToastManager } from "../ui/toast";
import { COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME } from "./composerPickerStyles";
import { ComposerPickerMenuPopup } from "./ComposerPickerMenuPopup";
import {
  MESSAGE_ACTION_BUTTON_CLASS_NAME,
  MESSAGE_ACTION_ICON_CLASS_NAME,
} from "./MessageActionButton";

/** Fixed icon column so worktree / local rows share one baseline (command-menu pattern). */
const FORK_MENU_ICON_SLOT_CLASS_NAME =
  "mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground/70";
const FORK_MENU_ICON_CLASS_NAME = "size-3.5";
const FORK_MENU_ITEM_CLASS_NAME = "items-start gap-2.5 px-2.5 py-2";

export type MessageForkTarget = "local" | "worktree";

const ANCHORED_TOAST_TIMEOUT_MS = 1400;

type MessageForkButtonProps = {
  className?: string;
  disabled?: boolean;
  localDescription: string;
  /** Create the fork and open it (immediate navigate). */
  onFork: (target: MessageForkTarget) => void | Promise<void>;
};

function showForkToast(anchor: HTMLElement | null, title: string): void {
  if (!anchor) return;
  anchoredToastManager.add({
    data: {
      tooltipStyle: true,
    },
    positionerProps: {
      anchor,
    },
    timeout: ANCHORED_TOAST_TIMEOUT_MS,
    title,
  });
}

export function MessageForkButton({
  className,
  disabled,
  localDescription,
  onFork,
}: MessageForkButtonProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleTarget = async (target: MessageForkTarget) => {
    if (busy || disabled) return;
    setBusy(true);
    setMenuOpen(false);

    const origin =
      triggerRef.current ?? document.querySelector<HTMLButtonElement>("[data-message-fork-button]");

    showForkToast(
      origin,
      target === "worktree" ? "Forking into new worktree…" : "Forking into local…",
    );

    try {
      await onFork(target);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Menu
      modal={false}
      open={menuOpen}
      onOpenChange={(nextOpen) => {
        if (disabled || busy) {
          setMenuOpen(false);
          return;
        }
        setMenuOpen(nextOpen);
      }}
    >
      <MenuTrigger
        ref={triggerRef}
        type="button"
        disabled={disabled || busy}
        title="Fork chat"
        aria-label="Fork chat"
        data-message-fork-button=""
        className={cn(
          MESSAGE_ACTION_BUTTON_CLASS_NAME,
          "inline-flex items-center justify-center",
          className,
        )}
      >
        <ChatBranchIcon className={MESSAGE_ACTION_ICON_CLASS_NAME} />
      </MenuTrigger>
      <ComposerPickerMenuPopup
        align="start"
        side="top"
        sideOffset={6}
        className={cn(
          COMPOSER_COMMAND_MENU_SURFACE_CLASS_NAME,
          "min-w-[14.5rem] !bg-popover shadow-lg before:!hidden",
        )}
      >
        <MenuItem
          className={FORK_MENU_ITEM_CLASS_NAME}
          disabled={busy}
          data-message-fork-target="worktree"
          onClick={() => {
            void handleTarget("worktree");
          }}
        >
          <span className={FORK_MENU_ICON_SLOT_CLASS_NAME} aria-hidden>
            <WorktreeIcon className={FORK_MENU_ICON_CLASS_NAME} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left leading-snug">
            <span className="font-medium">Fork into new worktree</span>
            <span className="text-[11.5px] font-normal text-muted-foreground">
              Continue in a fresh worktree
            </span>
          </span>
        </MenuItem>
        <MenuItem
          className={FORK_MENU_ITEM_CLASS_NAME}
          disabled={busy}
          data-message-fork-target="local"
          onClick={() => {
            void handleTarget("local");
          }}
        >
          <span className={FORK_MENU_ICON_SLOT_CLASS_NAME} aria-hidden>
            <DeviceLaptopIcon className={FORK_MENU_ICON_CLASS_NAME} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left leading-snug">
            <span className="font-medium">Fork into local</span>
            <span className="text-[11.5px] font-normal text-muted-foreground">
              {localDescription}
            </span>
          </span>
        </MenuItem>
      </ComposerPickerMenuPopup>
    </Menu>
  );
}
