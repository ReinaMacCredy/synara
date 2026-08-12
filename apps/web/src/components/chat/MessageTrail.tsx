// FILE: MessageTrail.tsx
// Purpose: Left-gutter message rail with macOS-Dock-style magnification. The tick
//   nearest the pointer grows longest (Gaussian falloff on its neighbours) and a
//   side navigator shows every prompt in the conversation. Built on Veylen's
//   existing scroll engine: `activeStore` carries the current + visible viewport
//   highlights and `onSelect` jumps (shadcn's scrollToMessage). The hot path writes
//   tick transform / opacity straight to the DOM inside one coalesced rAF — no React state per move
//   — so it stays smooth and never re-renders the heavy timeline.
// Layer: Chat transcript shell (presentation)
// Depends on: pure magnification math in messageTrail.logic.ts (unit-tested).

import { type MessageId } from "@veylen/contracts";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { disclosureContentClassName } from "~/lib/disclosureMotion";
import { cn } from "~/lib/utils";
import { APP_TOOLTIP_SURFACE_CLASS_NAME } from "./composerPickerStyles";
import {
  computeFocusedIndex,
  computeGaussianWeights,
  computeRestStyles,
  computeSigma,
  computeTickStyles,
  computeTrailGeometry,
  type ActiveTrailStore,
  type MessageTrailItem,
  type TickStyle,
  type TrailGeometry,
} from "./messageTrail.logic";

interface MessageTrailProps {
  items: readonly MessageTrailItem[];
  /** Stable holder for current + visible highlights; only this component re-renders on change. */
  activeStore: ActiveTrailStore;
  onSelect: (messageId: MessageId) => void;
  /** Monotonic request counter used by the configurable conversation-navigator shortcut. */
  focusRequest?: number;
}

// Rail only renders once the centered transcript column (max 46rem) leaves a left
// gutter wide enough for the rail to sit clear of message text. Measured off the
// pane so a docked side panel / the sidebar is accounted for.
const MIN_PANE_WIDTH_PX = 864;
// Fixed rail box. Ticks grow rightward inside it (left-aligned, like the Dock).
const RAIL_WIDTH_PX = 56;
// Cap the scrollable tick viewport a bit below the full pane height so the rail
// reads as a centered band with breathing room; long histories scroll inside it
// (with top/bottom scroll-fade) instead of compressing to a tall solid block.
const RAIL_MAX_HEIGHT_RATIO = 0.8;
// Inset the ticks off the window edge so the rail isn't glued to the far left.
const TICK_LEFT_PAD_PX = 14;
const TICK_HEIGHT_PX = 2;
// Short at rest, long when magnified — a wide base→max gap is what reads as a
// real Dock magnification (left 14 + max 30 = 44px, clears the 56px rail).
const TICK_BASE_W = 6;
const TICK_MAX_W = 30;
// Vertical centre-to-centre gap — kept tight so the ticks read as one close
// stack at rest. The magnified width is independent of this gap (ticks grow
// sideways, not into each other), so tight spacing keeps full magnification.
const TICK_SPACING_PX = 10;
// Resting ticks stay faint; the reading-anchor tick is darker. Opacity is a fixed
// per-state colour — it never follows the cursor as a gradient.
const TICK_REST_OPACITY = 0.2;
const TICK_VISIBLE_OPACITY = 0.52;
const TICK_ANCHOR_OPACITY = 0.9;
// Only the single tick directly under the pointer/keyboard focus goes full black —
// its neighbours just grow in size, they don't darken (no opacity falloff).
const TICK_FOCUS_OPACITY = 1;
const NAVIGATOR_GAP_PX = 8;
const NAVIGATOR_CLOSE_DELAY_MS = 220;

export function MessageTrail({
  items,
  activeStore,
  onSelect,
  focusRequest = 0,
}: MessageTrailProps) {
  const rootRef = useRef<HTMLElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const listboxId = useId();
  const optionIdPrefix = useId();

  const [hasGutter, setHasGutter] = useState(false);
  const [navigatorHoverOpen, setNavigatorHoverOpen] = useState(false);
  const [navigatorFocusOpen, setNavigatorFocusOpen] = useState(false);

  // Reading-position highlights — fed by the timeline via a stable store so only
  // this rail re-renders when they change.
  const trailSnapshot = useSyncExternalStore(
    activeStore.subscribe,
    activeStore.get,
    activeStore.get,
  );
  const anchorIndex = items.findIndex((item) => item.id === trailSnapshot.currentId);
  const visibleIdSet = new Set(trailSnapshot.visibleIds);
  const visibleIndexes: number[] = [];
  items.forEach((item, index) => {
    if (visibleIdSet.has(item.id)) {
      visibleIndexes.push(index);
    }
  });
  const visibleIndexSet = new Set(visibleIndexes);

  const visible = hasGutter && items.length > 1;
  const navigatorOpen = visible && (navigatorHoverOpen || navigatorFocusOpen);

  // Tick layout depends only on the message count (fixed spacing, natural content
  // height) — never on the measured viewport — so the capped/scrolling viewport
  // can't feed its height back into the layout (no ResizeObserver loop).
  const geometry = computeTrailGeometry({ count: items.length, spacingPx: TICK_SPACING_PX });
  const tickVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => TICK_SPACING_PX,
    overscan: 12,
  });
  const optionVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listboxRef.current,
    estimateSize: () => 40,
    overscan: 8,
    enabled: navigatorOpen,
  });

  // --- Hot-path refs (read inside rAF; never trigger renders) ---------------
  const rafIdRef = useRef<number | null>(null);
  const navigatorCloseTimeoutRef = useRef<number | null>(null);
  // Raw viewport-relative pointer Y at the last move; content Y is derived per
  // frame by adding the live scrollTop, so magnification follows rail scrolling.
  const latestPointerClientYRef = useRef<number | null>(null);
  const focusOverrideIndexRef = useRef<number | null>(null);
  const geometryRef = useRef<TrailGeometry | null>(geometry);
  const viewportTopRef = useRef(0);
  const navigatorIndexRef = useRef(-1);
  const navigatorHoverOpenRef = useRef(navigatorHoverOpen);
  const navigatorFocusOpenRef = useRef(navigatorFocusOpen);
  const previousFocusRequestRef = useRef(focusRequest);
  const reducedMotionRef = useRef(false);
  // Mirror render values into refs so the rAF/handlers stay stable and current.
  // Mirrored in an effect (not during render) so the component stays eligible
  // for React Compiler; the rAF loop and handlers only fire post-commit.
  const itemsRef = useRef(items);
  const anchorIndexRef = useRef(anchorIndex);
  const visibleIndexesRef = useRef(visibleIndexes);
  const onSelectRef = useRef(onSelect);
  const visibleRef = useRef(visible);
  useEffect(() => {
    geometryRef.current = geometry;
    itemsRef.current = items;
    anchorIndexRef.current = anchorIndex;
    visibleIndexesRef.current = visibleIndexes;
    onSelectRef.current = onSelect;
    visibleRef.current = visible;
    navigatorHoverOpenRef.current = navigatorHoverOpen;
    navigatorFocusOpenRef.current = navigatorFocusOpen;
    // Keep the tick-ref array sized to the message count. Truncate only —
    // growth happens via the JSX ref callbacks, which run before this effect,
    // and a full refill here would wipe the elements they just attached.
    if (tickRefs.current.length > items.length) {
      tickRefs.current.length = items.length;
    }
    if (optionRefs.current.length > items.length) {
      optionRefs.current.length = items.length;
    }
  }, [
    geometry,
    items,
    anchorIndex,
    visibleIndexes,
    onSelect,
    visible,
    navigatorHoverOpen,
    navigatorFocusOpen,
  ]);

  // --- Imperative writers ----------------------------------------------------
  const writeStyles = (styles: readonly TickStyle[]) => {
    const refs = tickRefs.current;
    for (const virtualItem of tickVirtualizer.getVirtualItems()) {
      const i = virtualItem.index;
      const el = refs[i];
      if (!el) {
        continue;
      }
      el.style.transform = `scaleX(${styles[i]!.width / TICK_BASE_W})`;
      el.style.opacity = `${styles[i]!.opacity}`;
    }
  };

  const optionId = (index: number) => `${optionIdPrefix}-message-${index}`;

  const setNavigatorIndex = (index: number, scrollIntoView = false) => {
    const normalizedIndex = index >= 0 && index < itemsRef.current.length ? index : -1;
    const previousIndex = navigatorIndexRef.current;
    if (previousIndex !== normalizedIndex) {
      const previousOption = optionRefs.current[previousIndex];
      if (previousOption) {
        previousOption.dataset.active = "false";
        previousOption.setAttribute("aria-selected", "false");
      }
      navigatorIndexRef.current = normalizedIndex;
    }

    const nextOption = optionRefs.current[normalizedIndex];
    if (nextOption) {
      nextOption.dataset.active = "true";
      nextOption.setAttribute("aria-selected", "true");
    }
    if (scrollIntoView && normalizedIndex >= 0) {
      optionVirtualizer.scrollToIndex(normalizedIndex, { align: "auto" });
    }

    const listbox = listboxRef.current;
    if (listbox) {
      if (normalizedIndex >= 0) {
        listbox.setAttribute("aria-activedescendant", optionId(normalizedIndex));
      } else {
        listbox.removeAttribute("aria-activedescendant");
      }
    }
    focusOverrideIndexRef.current = normalizedIndex >= 0 ? normalizedIndex : null;
  };

  const applyHighlightFloors = (styles: TickStyle[]) => {
    const anchorIndexValue = anchorIndexRef.current;
    for (const index of visibleIndexesRef.current) {
      const style = styles[index];
      if (style) {
        style.opacity = Math.max(style.opacity, TICK_VISIBLE_OPACITY);
      }
    }
    const anchorStyle = anchorIndexValue >= 0 ? styles[anchorIndexValue] : undefined;
    if (anchorStyle) {
      anchorStyle.opacity = Math.max(anchorStyle.opacity, TICK_ANCHOR_OPACITY);
    }
  };

  // Pointer/keyboard away: restore the resting rail (anchor tick highlighted).
  const applyRest = () => {
    const styles = computeRestStyles(
      itemsRef.current.length,
      anchorIndexRef.current,
      TICK_BASE_W,
      TICK_REST_OPACITY,
      TICK_ANCHOR_OPACITY,
    );
    applyHighlightFloors(styles);
    writeStyles(styles);
  };

  // Position the ticks vertically in content space and reset to rest when idle.
  // Width changes never reflow this, so it only runs when the layout changes.
  const layoutTicks = () => {
    const geometryValue = geometryRef.current;
    if (!geometryValue) {
      return;
    }
    const refs = tickRefs.current;
    for (const virtualItem of tickVirtualizer.getVirtualItems()) {
      const i = virtualItem.index;
      const el = refs[i];
      if (!el) {
        continue;
      }
      const centerY = geometryValue.centerYs[i] ?? 0;
      el.style.top = `${centerY - TICK_HEIGHT_PX / 2}px`;
    }
    if (latestPointerClientYRef.current === null && focusOverrideIndexRef.current === null) {
      applyRest();
    }
  };

  // --- The magnification frame (single coalesced rAF) ------------------------
  const renderFrame = () => {
    rafIdRef.current = null;
    const geometry = geometryRef.current;
    if (!geometry || !visibleRef.current) {
      return;
    }
    const count = itemsRef.current.length;
    if (count === 0) {
      return;
    }
    // Pointer wins over keyboard focus when both are present. The stored pointer Y
    // is viewport-relative; add the live scrollTop to land in tick content space.
    let activeY: number | null = null;
    const rawPointerY = latestPointerClientYRef.current;
    if (rawPointerY !== null) {
      activeY = rawPointerY + (viewportRef.current?.scrollTop ?? 0);
    } else if (focusOverrideIndexRef.current !== null) {
      activeY = geometry.centerYs[focusOverrideIndexRef.current] ?? null;
    }
    if (activeY === null) {
      applyRest();
      return;
    }
    const anchor = anchorIndexRef.current;
    const focusedIndex = computeFocusedIndex(activeY, geometry);

    let styles: TickStyle[];
    if (geometry.spacing === 0 || reducedMotionRef.current) {
      // Degenerate rail or reduced motion: the focused tick jumps to max width with
      // no continuous morphing (its colour is set below, same as the Gaussian branch).
      styles = computeRestStyles(
        count,
        anchor,
        TICK_BASE_W,
        TICK_REST_OPACITY,
        TICK_ANCHOR_OPACITY,
      );
      const focusedStyle = styles[focusedIndex];
      if (focusedStyle) {
        focusedStyle.width = TICK_MAX_W;
      }
    } else {
      // Width grows horizontally while ticks stack vertically (2px tall each), so
      // the focal tick reaches the full TICK_MAX_W regardless of how tight the
      // vertical spacing is — it never overlaps its neighbours.
      const sigma = computeSigma(geometry.spacing);
      const weights = computeGaussianWeights(geometry.centerYs, activeY, sigma);
      styles = computeTickStyles(
        weights,
        anchor,
        TICK_BASE_W,
        TICK_MAX_W,
        TICK_REST_OPACITY,
        TICK_ANCHOR_OPACITY,
      );
    }
    applyHighlightFloors(styles);
    // Darken only the focused tick — neighbours keep their state colour.
    const focusedStyle = styles[focusedIndex];
    if (focusedStyle) {
      focusedStyle.opacity = TICK_FOCUS_OPACITY;
    }
    writeStyles(styles);
    setNavigatorIndex(focusedIndex);
  };

  const scheduleFrame = () => {
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(renderFrame);
    }
  };

  const cancelFrame = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  // --- Gutter visibility: rail only shows when the pane is wide enough --------
  // Width-only ResizeObserver; the tick layout is count-driven (see `geometry`),
  // so observing size never feeds back into the layout.
  useEffect(() => {
    const root = rootRef.current;
    const pane = root?.parentElement;
    if (!pane || typeof ResizeObserver === "undefined") {
      return;
    }
    let pendingRaf: number | null = null;
    const measure = () => {
      pendingRaf = null;
      setHasGutter(pane.clientWidth >= MIN_PANE_WIDTH_PX);
    };
    const schedule = () => {
      if (pendingRaf === null) {
        pendingRaf = requestAnimationFrame(measure);
      }
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    return () => {
      if (pendingRaf !== null) {
        cancelAnimationFrame(pendingRaf);
      }
      observer.disconnect();
    };
  }, []);

  // Reposition the ticks whenever the layout changes (count → new centres).
  useEffect(() => {
    layoutTicks();
  }, [geometry, layoutTicks]);

  // Refresh idle highlights when the current anchor or visible-message set changes.
  useEffect(() => {
    if (latestPointerClientYRef.current === null && focusOverrideIndexRef.current === null) {
      applyRest();
    }
  }, [anchorIndex, applyRest, visibleIndexes]);

  // Read the motion preference once (continuous width morphing is motion).
  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
  }, []);

  // Keep one active option while the navigator is open. The active row is written
  // imperatively so rail pointer movement never re-renders the full list.
  useEffect(() => {
    if (!navigatorOpen) {
      setNavigatorIndex(-1);
      return;
    }
    const currentIndex = navigatorIndexRef.current;
    const nextIndex =
      currentIndex >= 0 && currentIndex < items.length
        ? currentIndex
        : anchorIndex >= 0
          ? anchorIndex
          : items.length > 0
            ? 0
            : -1;
    setNavigatorIndex(nextIndex, true);
    if (nextIndex >= 0) {
      scheduleFrame();
    }
  }, [anchorIndex, items.length, navigatorOpen, scheduleFrame, setNavigatorIndex]);

  // The shortcut is dispatched by the focused ChatView instance, so split panes
  // open only their own navigator instead of racing global listeners.
  useEffect(() => {
    if (focusRequest === previousFocusRequestRef.current) {
      return;
    }
    if (!visible) {
      return;
    }
    previousFocusRequestRef.current = focusRequest;
    setNavigatorFocusOpen(true);
    setNavigatorIndex(anchorIndex >= 0 ? anchorIndex : 0, true);
  }, [anchorIndex, focusRequest, setNavigatorIndex, visible]);

  useEffect(() => {
    if (navigatorOpen && navigatorFocusOpen) {
      listboxRef.current?.focus({ preventScroll: true });
    }
  }, [navigatorFocusOpen, navigatorOpen]);

  // Going inert (narrow pane / N<=1): stop the loop and clear transient state.
  useEffect(() => {
    if (!visible) {
      if (navigatorCloseTimeoutRef.current !== null) {
        window.clearTimeout(navigatorCloseTimeoutRef.current);
        navigatorCloseTimeoutRef.current = null;
      }
      cancelFrame();
      latestPointerClientYRef.current = null;
      focusOverrideIndexRef.current = null;
      setNavigatorHoverOpen(false);
      setNavigatorFocusOpen(false);
      setNavigatorIndex(-1);
    }
  }, [visible, cancelFrame, setNavigatorIndex]);

  // Unmount: MessageTrail outlives thread switches (the timeline is keyed), so a
  // stray in-flight frame must be cancelled.
  useEffect(
    () => () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (navigatorCloseTimeoutRef.current !== null) {
        window.clearTimeout(navigatorCloseTimeoutRef.current);
      }
    },
    [],
  );

  // --- Pointer handlers (mouse / pen only; touch must not hijack scroll) -----
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || !visibleRef.current) {
      return;
    }
    latestPointerClientYRef.current = event.clientY - viewportTopRef.current;
    scheduleFrame();
  };

  const handlePointerEnter = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" || !visibleRef.current) {
      return;
    }
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      viewportTopRef.current = rect.top;
    }
    latestPointerClientYRef.current = event.clientY - viewportTopRef.current;
    scheduleFrame();
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") {
      return;
    }
    latestPointerClientYRef.current = null;
    cancelFrame();
    // A keyboard-focused tick keeps its magnification; otherwise go to rest.
    if (focusOverrideIndexRef.current !== null) {
      scheduleFrame();
    } else {
      applyRest();
    }
  };

  // Rail scrolling under a stationary pointer changes which tick is focused, so
  // keep the magnification + active list row in sync while the pointer/keyboard is engaged.
  const handleScroll = () => {
    if (latestPointerClientYRef.current !== null || focusOverrideIndexRef.current !== null) {
      scheduleFrame();
    }
  };

  // Big hit-area: clicking anywhere on the rail jumps to the nearest tick.
  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const geometryValue = geometryRef.current;
    const viewport = viewportRef.current;
    if (!geometryValue || !viewport) {
      return;
    }
    const contentY = event.clientY - viewport.getBoundingClientRect().top + viewport.scrollTop;
    const index = computeFocusedIndex(contentY, geometryValue);
    const item = itemsRef.current[index];
    if (item) {
      setNavigatorIndex(index, true);
      onSelectRef.current(item.id);
    }
  };

  const selectNavigatorIndex = (index: number) => {
    const item = itemsRef.current[index];
    if (!item) {
      return;
    }
    setNavigatorIndex(index, true);
    onSelectRef.current(item.id);
  };

  const handleOptionPointer = (index: number) => {
    const railPointerWasActive = latestPointerClientYRef.current !== null;
    latestPointerClientYRef.current = null;
    if (railPointerWasActive || navigatorIndexRef.current !== index) {
      setNavigatorIndex(index);
      scheduleFrame();
    }
  };

  const handleTriggerFocus = () => {
    setNavigatorFocusOpen(true);
    setNavigatorIndex(anchorIndexRef.current >= 0 ? anchorIndexRef.current : 0, true);
  };

  const handleListboxKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextIndex: number | null = null;
    switch (event.key) {
      case "ArrowDown":
        nextIndex =
          navigatorIndexRef.current < 0
            ? 0
            : Math.min(navigatorIndexRef.current + 1, itemsRef.current.length - 1);
        break;
      case "ArrowUp":
        nextIndex =
          navigatorIndexRef.current < 0
            ? itemsRef.current.length - 1
            : Math.max(navigatorIndexRef.current - 1, 0);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = itemsRef.current.length - 1;
        break;
      case "Enter":
        event.preventDefault();
        if (navigatorIndexRef.current >= 0) {
          selectNavigatorIndex(navigatorIndexRef.current);
        }
        return;
      case "Escape":
        event.preventDefault();
        setNavigatorHoverOpen(false);
        setNavigatorFocusOpen(false);
        listboxRef.current?.blur();
        return;
      default:
        return;
    }
    event.preventDefault();
    setNavigatorIndex(nextIndex ?? -1, true);
    if (nextIndex !== null && nextIndex >= 0) {
      scheduleFrame();
    }
  };

  const handleRailBlur = (event: ReactFocusEvent<HTMLElement>) => {
    const root = rootRef.current;
    if (root && event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) {
      return;
    }
    setNavigatorFocusOpen(false);
    if (!navigatorHoverOpenRef.current) {
      focusOverrideIndexRef.current = null;
      setNavigatorIndex(-1);
      applyRest();
    }
  };

  const handleRootPointerEnter = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || !visibleRef.current) {
      return;
    }
    if (navigatorCloseTimeoutRef.current !== null) {
      window.clearTimeout(navigatorCloseTimeoutRef.current);
      navigatorCloseTimeoutRef.current = null;
    }
    setNavigatorHoverOpen(true);
    if (navigatorIndexRef.current < 0) {
      setNavigatorIndex(anchorIndexRef.current >= 0 ? anchorIndexRef.current : 0, true);
    }
  };

  const handleRootPointerLeave = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch") {
      return;
    }
    latestPointerClientYRef.current = null;
    if (navigatorCloseTimeoutRef.current !== null) {
      window.clearTimeout(navigatorCloseTimeoutRef.current);
    }
    navigatorCloseTimeoutRef.current = window.setTimeout(() => {
      navigatorCloseTimeoutRef.current = null;
      setNavigatorHoverOpen(false);
      if (!navigatorFocusOpenRef.current) {
        cancelFrame();
        focusOverrideIndexRef.current = null;
        setNavigatorIndex(-1);
        applyRest();
      }
    }, NAVIGATOR_CLOSE_DELAY_MS);
  };

  return (
    <nav
      ref={rootRef}
      aria-label="Conversation navigation"
      aria-hidden={!visible}
      onBlur={handleRailBlur}
      onPointerEnter={handleRootPointerEnter}
      onPointerLeave={handleRootPointerLeave}
      className={cn(
        "absolute inset-y-0 left-0 z-20 hidden flex-col justify-center sm:flex",
        disclosureContentClassName(visible),
      )}
      style={{ width: RAIL_WIDTH_PX }}
    >
      {/* Capped, centered, scrollable viewport. `scroll-fade-y` masks the top/bottom
          edges only while there is overflow to scroll (auto-off when it all fits). */}
      <div
        ref={viewportRef}
        role="button"
        tabIndex={visible && !navigatorOpen ? 0 : -1}
        aria-label="Open conversation navigator"
        aria-expanded={navigatorOpen}
        aria-controls={listboxId}
        onFocus={handleTriggerFocus}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onMouseDown={(event) => event.preventDefault()}
        onScroll={handleScroll}
        onClick={handleClick}
        className={cn(
          "scroll-fade-y relative w-full overflow-y-auto overscroll-contain bg-transparent text-left outline-none [contain:layout] [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-border)] [&::-webkit-scrollbar]:hidden",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
        style={{ maxHeight: `${RAIL_MAX_HEIGHT_RATIO * 100}%` }}
      >
        <div ref={trackRef} className="relative w-full" style={{ height: geometry?.contentHeight }}>
          {tickVirtualizer.getVirtualItems().map((virtualItem) => {
            const index = virtualItem.index;
            const item = items[index]!;
            return (
              <span
                key={item.id}
                ref={(el) => {
                  tickRefs.current[index] = el;
                }}
                aria-hidden="true"
                className="absolute origin-left rounded-full transition-[transform,opacity] duration-[90ms] ease-out motion-reduce:transition-none"
                style={{
                  left: TICK_LEFT_PAD_PX,
                  height: TICK_HEIGHT_PX,
                  width: TICK_BASE_W,
                  opacity:
                    index === anchorIndex
                      ? TICK_ANCHOR_OPACITY
                      : visibleIndexSet.has(index)
                        ? TICK_VISIBLE_OPACITY
                        : TICK_REST_OPACITY,
                  backgroundColor: "var(--color-text-foreground)",
                  willChange: "transform, opacity",
                }}
              />
            );
          })}
        </div>
      </div>
      <div
        aria-hidden={!navigatorOpen}
        inert={!navigatorOpen}
        className={cn(
          "absolute top-1/2 w-[min(28rem,calc(100vw-5rem))] -translate-y-1/2",
          navigatorOpen ? "pointer-events-auto" : "pointer-events-none",
        )}
        style={{ left: RAIL_WIDTH_PX, paddingLeft: NAVIGATOR_GAP_PX }}
      >
        <div
          className={disclosureContentClassName(
            navigatorOpen,
            cn(
              APP_TOOLTIP_SURFACE_CLASS_NAME,
              "max-h-[min(72dvh,36rem)] overflow-hidden rounded-[1.375rem]! p-2",
            ),
          )}
        >
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            tabIndex={navigatorOpen ? 0 : -1}
            aria-label="Conversation messages"
            onFocus={() => setNavigatorFocusOpen(true)}
            onKeyDown={handleListboxKeyDown}
            className="scroll-fade-y max-h-[min(72dvh,36rem)] overflow-y-auto overscroll-contain outline-none [scrollbar-width:thin]"
          >
            <div className="relative w-full" style={{ height: optionVirtualizer.getTotalSize() }}>
              {navigatorOpen
                ? optionVirtualizer.getVirtualItems().map((virtualItem) => {
                    const index = virtualItem.index;
                    const item = items[index]!;
                    return (
                      <button
                        key={item.id}
                        ref={(element) => {
                          optionRefs.current[index] = element;
                          if (element) {
                            const active = navigatorIndexRef.current === index;
                            element.dataset.active = String(active);
                            element.setAttribute("aria-selected", String(active));
                          }
                        }}
                        id={optionId(index)}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={navigatorIndexRef.current === index}
                        aria-current={index === anchorIndex ? "location" : undefined}
                        data-active={navigatorIndexRef.current === index}
                        onPointerEnter={() => handleOptionPointer(index)}
                        onPointerMove={() => handleOptionPointer(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectNavigatorIndex(index)}
                        className="absolute left-0 top-0 flex w-full min-w-0 items-center rounded-xl px-4 py-2.5 text-left text-[15px] leading-5 text-foreground/84 outline-none hover:bg-[var(--color-background-button-secondary-hover)] data-[active=true]:bg-[var(--color-background-button-secondary-hover)]"
                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                        title={item.preview}
                      >
                        <span className="min-w-0 flex-1 truncate">{item.preview}</span>
                        <span className="sr-only">Jump to message {item.ordinal}</span>
                      </button>
                    );
                  })
                : null}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
