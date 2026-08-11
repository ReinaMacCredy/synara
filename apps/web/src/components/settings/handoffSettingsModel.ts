import type { ProviderKind } from "@veylen/contracts";
import { getDefaultModel } from "@veylen/shared/model";

type HandoffModelOption = {
  readonly slug: string;
};

export function resolveHandoffSettingsModel(input: {
  readonly provider: ProviderKind;
  readonly rememberedModel: string | null | undefined;
  readonly options: ReadonlyArray<HandoffModelOption>;
}): string {
  const rememberedModel = input.rememberedModel?.trim();
  if (rememberedModel && input.options.some((option) => option.slug === rememberedModel)) {
    return rememberedModel;
  }

  const providerDefault = getDefaultModel(input.provider);
  if (providerDefault && input.options.some((option) => option.slug === providerDefault)) {
    return providerDefault;
  }

  return input.options[0]?.slug ?? rememberedModel ?? providerDefault ?? "";
}
