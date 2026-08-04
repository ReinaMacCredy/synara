import { useEffect, useId, useState } from "react";

import { cn } from "~/lib/utils";

const TEXT_SWAP_MS = 200;

type TextSwapState = {
  phrase: string;
  previousPhrase: string | null;
};

export function AnimatedTextSwap(props: {
  phrase: string;
  className?: string;
  shimmer?: boolean;
  rootData?: Record<`data-${string}`, string>;
}) {
  const statusId = useId();
  const [phraseState, setPhraseState] = useState<TextSwapState>(() => ({
    phrase: props.phrase,
    previousPhrase: null,
  }));

  useEffect(() => {
    setPhraseState((current) =>
      current.phrase === props.phrase
        ? current
        : { phrase: props.phrase, previousPhrase: current.phrase },
    );
  }, [props.phrase]);

  useEffect(() => {
    if (phraseState.previousPhrase === null) return;
    const cleanup = window.setTimeout(() => {
      setPhraseState((current) =>
        current.previousPhrase === phraseState.previousPhrase
          ? { ...current, previousPhrase: null }
          : current,
      );
    }, TEXT_SWAP_MS);
    return () => window.clearTimeout(cleanup);
  }, [phraseState.previousPhrase]);

  const longestPhrase = [phraseState.phrase, phraseState.previousPhrase ?? ""].reduce(
    (longest, current) => (current.length > longest.length ? current : longest),
  );
  const phraseClassName = cn(props.shimmer && "shimmer motion-reduce:animate-none");

  return (
    <span
      role="status"
      aria-live="polite"
      aria-labelledby={statusId}
      className={cn("inline-flex max-w-full items-center", props.className)}
      data-animated-text-swap="true"
      {...props.rootData}
    >
      <span aria-hidden="true" className="grid overflow-hidden text-left">
        <span className="invisible col-start-1 row-start-1 whitespace-nowrap">
          {longestPhrase}
        </span>
        {phraseState.previousPhrase === null ? null : (
          <span className="reasoning-text-swap__phrase reasoning-text-swap__phrase--exit col-start-1 row-start-1 inline-block justify-self-start whitespace-nowrap">
            <span className={phraseClassName}>{phraseState.previousPhrase}</span>
          </span>
        )}
        <span
          key={phraseState.phrase}
          className="reasoning-text-swap__phrase reasoning-text-swap__phrase--enter col-start-1 row-start-1 inline-block justify-self-start whitespace-nowrap"
        >
          <span className={phraseClassName}>{phraseState.phrase}</span>
        </span>
      </span>
      <span id={statusId} className="sr-only">
        {phraseState.phrase}
      </span>
    </span>
  );
}
