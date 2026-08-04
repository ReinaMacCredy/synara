import { useEffect, useId, useState } from "react";

export const REASONING_TEXT_SWAP_PHRASES = [
  "Thinking",
  "Reading the request",
  "Working through the details",
  "Preparing the answer",
] as const;

export const REASONING_TEXT_SWAP_INTERVAL_MS = 1_800;
const REASONING_PHRASE_SWAP_MS = 200;

export type ReasoningSwapState = {
  index: number;
  previousIndex: number | null;
};

export const INITIAL_REASONING_SWAP_STATE: ReasoningSwapState = {
  index: 0,
  previousIndex: null,
};

export function advanceReasoningSwapState(
  current: ReasoningSwapState,
): ReasoningSwapState {
  return {
    index: (current.index + 1) % REASONING_TEXT_SWAP_PHRASES.length,
    previousIndex: current.index,
  };
}

export function ReasoningTextSwap(props: { active: boolean }) {
  const [swapState, setSwapState] =
    useState<ReasoningSwapState>(INITIAL_REASONING_SWAP_STATE);
  const statusId = useId();
  const phrase =
    REASONING_TEXT_SWAP_PHRASES[swapState.index] ?? REASONING_TEXT_SWAP_PHRASES[0];
  const previousPhrase =
    swapState.previousIndex === null
      ? null
      : (REASONING_TEXT_SWAP_PHRASES[swapState.previousIndex] ?? null);
  const longestPhrase = REASONING_TEXT_SWAP_PHRASES.reduce((longest, current) =>
    current.length > longest.length ? current : longest,
  );

  useEffect(() => {
    if (!props.active) {
      setSwapState((current) =>
        current.index === 0 && current.previousIndex === null
          ? current
          : INITIAL_REASONING_SWAP_STATE,
      );
      return;
    }

    const timer = window.setInterval(() => {
      setSwapState(advanceReasoningSwapState);
    }, REASONING_TEXT_SWAP_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [props.active]);

  useEffect(() => {
    if (swapState.previousIndex === null) return;

    const cleanup = window.setTimeout(() => {
      setSwapState((current) =>
        current.previousIndex === swapState.previousIndex
          ? { ...current, previousIndex: null }
          : current,
      );
    }, REASONING_PHRASE_SWAP_MS);

    return () => window.clearTimeout(cleanup);
  }, [swapState.previousIndex]);

  return (
    <span
      role="status"
      aria-live="polite"
      aria-labelledby={statusId}
      className="inline-flex max-w-full items-center"
      data-reasoning-text-swap="true"
    >
      <span aria-hidden="true" className="grid overflow-hidden text-left">
        <span className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {longestPhrase}…
        </span>
        {previousPhrase === null ? null : (
          <span className="reasoning-text-swap__phrase reasoning-text-swap__phrase--exit col-start-1 row-start-1 inline-block justify-self-start whitespace-nowrap">
            <span className="shimmer motion-reduce:animate-none">{previousPhrase}…</span>
          </span>
        )}
        <span
          key={phrase}
          className={`reasoning-text-swap__phrase col-start-1 row-start-1 inline-block justify-self-start whitespace-nowrap${
            previousPhrase === null ? "" : " reasoning-text-swap__phrase--enter"
          }`}
        >
          <span className="shimmer motion-reduce:animate-none">
            {phrase}…
          </span>
        </span>
      </span>
      <span id={statusId} className="sr-only">
        {phrase}
      </span>
    </span>
  );
}
