// FILE: CadencedShimmer.tsx
// Purpose: Cadenced highlight sweep on status text (Thinking / Working / tools).
// Depends on: cadenced-shimmer.css

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "~/lib/utils";

import "./cadenced-shimmer.css";

// ~1s active sweep, then idle until the next interval.
const CADENCE_INTERVAL_MS = 2_200;
const ACTIVE_DURATION_MS = 1_000;
const FIRST_PULSE_DELAY_MS = 400;

export function CadencedShimmer(props: {
  children: ReactNode;
  active?: boolean;
  className?: string;
}) {
  const active = props.active !== false;
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !active) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let clearActiveTimeout: number | undefined;
    let intervalId: number | undefined;
    let firstTimeout: number | undefined;

    const pulse = () => {
      el.classList.remove("cadenced-shimmer--active");
      void el.offsetWidth;
      el.classList.add("cadenced-shimmer--active");
      if (clearActiveTimeout !== undefined) window.clearTimeout(clearActiveTimeout);
      clearActiveTimeout = window.setTimeout(() => {
        el.classList.remove("cadenced-shimmer--active");
        clearActiveTimeout = undefined;
      }, ACTIVE_DURATION_MS);
    };

    firstTimeout = window.setTimeout(() => {
      pulse();
      intervalId = window.setInterval(pulse, CADENCE_INTERVAL_MS);
    }, FIRST_PULSE_DELAY_MS);

    return () => {
      if (firstTimeout !== undefined) window.clearTimeout(firstTimeout);
      if (intervalId !== undefined) window.clearInterval(intervalId);
      if (clearActiveTimeout !== undefined) window.clearTimeout(clearActiveTimeout);
      el.classList.remove("cadenced-shimmer--active");
    };
  }, [active]);

  if (!active) {
    return <span className={props.className}>{props.children}</span>;
  }

  return (
    <span
      ref={rootRef}
      className={cn("cadenced-shimmer", props.className)}
      data-cadenced-shimmer="true"
    >
      {props.children}
      <span className="cadenced-shimmer__sweep" aria-hidden="true">
        <span className="cadenced-shimmer__highlight">{props.children}</span>
      </span>
    </span>
  );
}
