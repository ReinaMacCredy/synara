import { useEffect, useState } from "react";

import { AnimatedTextSwap } from "./AnimatedTextSwap";

const REASONING_FALLBACK_PHRASE = "Thinking…";

export function ReasoningTextSwap(props: {
  active: boolean;
  scopeKey: string;
  providerPhrase?: string | null;
}) {
  return (
    <ReasoningTextSwapStateful
      key={props.scopeKey}
      active={props.active}
      {...(props.providerPhrase !== undefined ? { providerPhrase: props.providerPhrase } : {})}
    />
  );
}

function ReasoningTextSwapStateful(props: {
  active: boolean;
  providerPhrase?: string | null;
}) {
  const providerPhrase = props.providerPhrase?.trim() || null;
  const [latchedProviderPhrase, setLatchedProviderPhrase] = useState(providerPhrase);

  useEffect(() => {
    if (!props.active) {
      setLatchedProviderPhrase(null);
      return;
    }
    if (!providerPhrase) return;
    setLatchedProviderPhrase(providerPhrase);
  }, [props.active, providerPhrase]);

  if (!props.active) return null;

  return (
    <AnimatedTextSwap
      phrase={latchedProviderPhrase ?? REASONING_FALLBACK_PHRASE}
      className="mt-3"
      shimmer
      rootData={{
        "data-reasoning-text-swap": "true",
        "data-reasoning-source": latchedProviderPhrase ? "provider" : "synthetic",
      }}
    />
  );
}
