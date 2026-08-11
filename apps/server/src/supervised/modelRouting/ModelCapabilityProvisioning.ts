import type {
  ModelCapabilityProfile,
  ProviderListModelsResult,
  ProviderModelDescriptor,
} from "@veylen/contracts";

export const OWNER_CURATED_MODEL_PROVENANCE = "owner-curated";

export type ModelCapabilityCatalogStatus = "catalog_matched" | "owner_curated_only";

export class ModelCapabilityProvisioningError extends Error {
  readonly _tag = "ModelCapabilityProvisioningError";

  constructor(
    readonly code:
      | "owner_curated_provenance_required"
      | "catalog_model_mismatch"
      | "provenance_limit_exceeded",
    message: string,
  ) {
    super(message);
  }
}

export interface PreparedOwnerCuratedModelCapabilityProfile {
  readonly profile: ModelCapabilityProfile;
  readonly catalogStatus: ModelCapabilityCatalogStatus;
  readonly catalogSource: string | null;
}

const descriptorMatchesProfile = (
  descriptor: ProviderModelDescriptor,
  profile: ModelCapabilityProfile,
): boolean => descriptor.slug === profile.model || descriptor.resolvedModel === profile.model;

export function prepareOwnerCuratedModelCapabilityProfile(input: {
  readonly profile: ModelCapabilityProfile;
  readonly catalog: ProviderListModelsResult | null;
  readonly updatedAt: string;
}): PreparedOwnerCuratedModelCapabilityProfile {
  if (!input.profile.provenance.includes(OWNER_CURATED_MODEL_PROVENANCE)) {
    throw new ModelCapabilityProvisioningError(
      "owner_curated_provenance_required",
      `Capability profile '${input.profile.id}' must identify '${OWNER_CURATED_MODEL_PROVENANCE}' as the source of its capability scores.`,
    );
  }

  const matched = input.catalog?.models.find((descriptor) =>
    descriptorMatchesProfile(descriptor, input.profile),
  );
  if (input.catalog && input.catalog.models.length > 0 && !matched) {
    throw new ModelCapabilityProvisioningError(
      "catalog_model_mismatch",
      `Model '${input.profile.model}' is not present in the current '${input.profile.provider}' provider catalog.`,
    );
  }

  const catalogSource = matched ? (input.catalog?.source ?? "provider-runtime") : null;
  const catalogProvenance = catalogSource
    ? `provider-catalog:${input.profile.provider}:${catalogSource}`
    : null;
  const provenance = [
    ...input.profile.provenance,
    ...(catalogProvenance && !input.profile.provenance.includes(catalogProvenance)
      ? [catalogProvenance]
      : []),
  ];
  if (provenance.length > 32) {
    throw new ModelCapabilityProvisioningError(
      "provenance_limit_exceeded",
      `Capability profile '${input.profile.id}' has no room for canonical catalog provenance.`,
    );
  }

  return {
    profile: { ...input.profile, provenance, updatedAt: input.updatedAt },
    catalogStatus: matched ? "catalog_matched" : "owner_curated_only",
    catalogSource,
  };
}
