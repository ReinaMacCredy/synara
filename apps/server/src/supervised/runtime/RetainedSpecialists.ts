import type {
  AuthorityScope,
  Specialist,
  SpecialistSnapshot,
} from "@synara/contracts";

const sameScope = (left: AuthorityScope, right: AuthorityScope) =>
  JSON.stringify(left) === JSON.stringify(right);

export interface SpecialistResumeInput {
  readonly specialist: Specialist;
  readonly snapshot: SpecialistSnapshot;
  readonly requestedScope: AuthorityScope;
  readonly activeProfileContentHash: SpecialistSnapshot["profileContentHash"];
  readonly supportedSchemaVersions: ReadonlySet<string>;
  readonly now: string;
}

export interface SpecialistResumeDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export function mayResumeSpecialist(input: SpecialistResumeInput): SpecialistResumeDecision {
  if (input.specialist.status === "revoked" || input.specialist.status === "expired") {
    return { allowed: false, reason: `Specialist is ${input.specialist.status}.` };
  }
  if (Date.parse(input.specialist.expiresAt) <= Date.parse(input.now)) {
    return { allowed: false, reason: "Specialist retention expired." };
  }
  if (Date.parse(input.snapshot.expiresAt) <= Date.parse(input.now)) {
    return { allowed: false, reason: "Specialist snapshot expired." };
  }
  if (!input.snapshot.sanitized) {
    return { allowed: false, reason: "Specialist snapshot is not sanitized." };
  }
  if (input.snapshot.profileContentHash !== input.activeProfileContentHash) {
    return { allowed: false, reason: "Specialist profile changed since the snapshot." };
  }
  if (!input.specialist.allowedScopes.some((scope) => sameScope(scope, input.requestedScope))) {
    return { allowed: false, reason: "Requested scope is not retained." };
  }
  if (
    !input.snapshot.compatibleSchemaVersions.every((version) =>
      input.supportedSchemaVersions.has(version),
    )
  ) {
    return { allowed: false, reason: "Specialist snapshot schema is incompatible." };
  }
  return { allowed: true, reason: "Specialist snapshot is authorized and compatible." };
}
