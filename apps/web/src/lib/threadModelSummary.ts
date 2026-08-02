import type { ModelSelection, ProviderKind } from "@synara/contracts";

import {
  getComposerTraitSelection,
  resolveComposerTraitStatusLabel,
  showsComposerFastModeBadge,
} from "~/components/chat/composerTraits";
import { formatProviderModelOptionName, type ProviderOptions } from "~/providerModelOptions";

export interface ThreadModelSummary {
  provider: ProviderKind;
  modelLabel: string;
  statusLabel: string | null;
  fastMode: boolean;
}

export function resolveThreadModelSummary(
  modelSelection: ModelSelection | null | undefined,
): ThreadModelSummary | null {
  if (!modelSelection) {
    return null;
  }
  const provider = modelSelection.provider;
  const modelLabel = formatProviderModelOptionName({ provider, slug: modelSelection.model });
  if (modelLabel.length === 0) {
    return null;
  }
  const traits = getComposerTraitSelection(
    provider,
    modelSelection.model,
    "",
    modelSelection.options as ProviderOptions | undefined,
  );
  return {
    provider,
    modelLabel,
    statusLabel: resolveComposerTraitStatusLabel(traits),
    fastMode: showsComposerFastModeBadge(traits),
  };
}
