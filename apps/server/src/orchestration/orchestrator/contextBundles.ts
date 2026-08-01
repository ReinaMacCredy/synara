import {
  ContextBundle,
  type ActorIdentity,
  type ArtifactId,
  type AssignmentId,
  type ContextBundleId,
  type OrchestratorCapability,
  type OrchestratorMessageId,
} from "@synara/contracts";
import { Schema } from "effect";

import { canonicalJson, sha256 } from "./briefs.ts";

export interface ContextBundleInput {
  readonly id: ContextBundleId;
  readonly version: number;
  readonly assignmentId: AssignmentId | null;
  readonly originalBrief: string;
  readonly immutableUserConstraints: ReadonlyArray<string>;
  readonly acceptedDecisions: ReadonlyArray<string>;
  readonly rejectedAlternatives: ReadonlyArray<string>;
  readonly ownershipClaims: ReadonlyArray<string>;
  readonly dependencyRefs: ReadonlyArray<string>;
  readonly sourceRefs: ReadonlyArray<string>;
  readonly threadMessageRefs: ReadonlyArray<OrchestratorMessageId>;
  readonly artifactRefs: ReadonlyArray<ArtifactId>;
  readonly capabilityCeiling: ReadonlyArray<OrchestratorCapability>;
  readonly createdBy: ActorIdentity;
  readonly createdAt: string;
}

const uniqueSorted = <A extends string>(values: ReadonlyArray<A>): ReadonlyArray<A> =>
  [...new Set(values)].toSorted() as ReadonlyArray<A>;

const canonicalBundleBody = (input: ContextBundleInput) => ({
  id: input.id,
  version: input.version,
  assignmentId: input.assignmentId,
  originalBrief: input.originalBrief.normalize("NFC"),
  immutableUserConstraints: uniqueSorted(
    input.immutableUserConstraints.map((value) => value.normalize("NFC")),
  ),
  acceptedDecisions: uniqueSorted(input.acceptedDecisions.map((value) => value.normalize("NFC"))),
  rejectedAlternatives: uniqueSorted(
    input.rejectedAlternatives.map((value) => value.normalize("NFC")),
  ),
  ownershipClaims: uniqueSorted(input.ownershipClaims),
  dependencyRefs: uniqueSorted(input.dependencyRefs),
  sourceRefs: uniqueSorted(input.sourceRefs),
  threadMessageRefs: uniqueSorted(input.threadMessageRefs),
  artifactRefs: uniqueSorted(input.artifactRefs),
  capabilityCeiling: uniqueSorted(input.capabilityCeiling),
  createdBy: input.createdBy,
  createdAt: input.createdAt,
});

export const sealContextBundle = (input: ContextBundleInput): ContextBundle => {
  const body = canonicalBundleBody(input);
  return Schema.decodeUnknownSync(ContextBundle)({
    ...body,
    contentHash: sha256(canonicalJson(body)),
  });
};

export const verifyContextBundle = (bundle: ContextBundle): boolean => {
  const { contentHash, ...body } = bundle;
  return contentHash === sha256(canonicalJson(body));
};
