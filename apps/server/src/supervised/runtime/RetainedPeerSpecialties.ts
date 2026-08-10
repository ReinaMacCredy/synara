import type { AuthorityScope, PeerSpecialty, PeerSpecialtySnapshot } from "@synara/contracts";

const sameScope = (left: AuthorityScope, right: AuthorityScope) =>
  JSON.stringify(left) === JSON.stringify(right);

export interface PeerSpecialtyResumeInput {
  readonly specialty: PeerSpecialty;
  readonly snapshot: PeerSpecialtySnapshot;
  readonly requestedScope: AuthorityScope;
  readonly activeProfileContentHash: PeerSpecialtySnapshot["profileContentHash"];
  readonly supportedSchemaVersions: ReadonlySet<string>;
  readonly now: string;
}

export interface PeerSpecialtyResumeDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export function mayResumePeerSpecialty(
  input: PeerSpecialtyResumeInput,
): PeerSpecialtyResumeDecision {
  if (input.specialty.status === "revoked" || input.specialty.status === "expired") {
    return { allowed: false, reason: `Peer specialty is ${input.specialty.status}.` };
  }
  if (Date.parse(input.specialty.expiresAt) <= Date.parse(input.now)) {
    return { allowed: false, reason: "Peer specialty retention expired." };
  }
  if (Date.parse(input.snapshot.expiresAt) <= Date.parse(input.now)) {
    return { allowed: false, reason: "Peer specialty snapshot expired." };
  }
  if (!input.snapshot.sanitized) {
    return { allowed: false, reason: "Peer specialty snapshot is not sanitized." };
  }
  if (input.snapshot.profileContentHash !== input.activeProfileContentHash) {
    return { allowed: false, reason: "Peer profile changed since the snapshot." };
  }
  if (!input.specialty.allowedScopes.some((scope) => sameScope(scope, input.requestedScope))) {
    return { allowed: false, reason: "Requested scope is not retained." };
  }
  if (
    !input.snapshot.compatibleSchemaVersions.every((version) =>
      input.supportedSchemaVersions.has(version),
    )
  ) {
    return { allowed: false, reason: "Peer specialty snapshot schema is incompatible." };
  }
  return { allowed: true, reason: "Peer specialty snapshot is authorized and compatible." };
}
