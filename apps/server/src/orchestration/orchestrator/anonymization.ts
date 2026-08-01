import { sha256 } from "./briefs.ts";

export interface AttributableProposal {
  readonly artifactId: string;
  readonly content: string;
  readonly declaredIdentity: {
    readonly provider?: string;
    readonly model?: string;
    readonly threadId?: string;
    readonly authorName?: string;
    readonly styleLabel?: string;
  };
}

export interface AnonymousProposal {
  readonly label: string;
  readonly artifactHash: string;
  readonly content: string;
}

export interface AnonymousDossier {
  readonly proposals: ReadonlyArray<AnonymousProposal>;
  readonly attributionByLabel: Readonly<Record<string, string>>;
}

const LABELS = [
  "Alpha",
  "Beta",
  "Gamma",
  "Delta",
  "Epsilon",
  "Zeta",
  "Eta",
  "Theta",
  "Iota",
  "Kappa",
  "Lambda",
  "Mu",
  "Nu",
  "Xi",
  "Omicron",
  "Pi",
] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const redactDeclaredIdentity = (
  content: string,
  declaredIdentity: AttributableProposal["declaredIdentity"],
): string => {
  const declaredTokens = Object.values(declaredIdentity)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.normalize("NFKC"))
    .toSorted((left, right) => right.length - left.length);
  return declaredTokens.reduce(
    (current, token) =>
      current.replace(new RegExp(escapeRegExp(token), "giu"), "[identity-redacted]"),
    content.normalize("NFKC"),
  );
};

export const anonymizeProposals = (
  proposals: ReadonlyArray<AttributableProposal>,
): AnonymousDossier => {
  if (proposals.length > LABELS.length) {
    throw new RangeError(`Council V1 supports at most ${LABELS.length} anonymous proposals.`);
  }
  const normalized = proposals
    .map((proposal) => {
      const content = redactDeclaredIdentity(proposal.content, proposal.declaredIdentity);
      return {
        artifactId: proposal.artifactId,
        content,
        artifactHash: sha256(proposal.content.normalize("NFC")),
      };
    })
    .toSorted((left, right) =>
      `${left.artifactHash}:${left.artifactId}`.localeCompare(
        `${right.artifactHash}:${right.artifactId}`,
      ),
    );

  const attributionByLabel: Record<string, string> = {};
  const anonymous = normalized.map((proposal, index): AnonymousProposal => {
    const label = LABELS[index]!;
    attributionByLabel[label] = proposal.artifactId;
    return { label, artifactHash: proposal.artifactHash, content: proposal.content };
  });
  return { proposals: anonymous, attributionByLabel };
};
