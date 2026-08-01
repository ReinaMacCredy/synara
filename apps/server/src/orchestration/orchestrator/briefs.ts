import { createHash } from "node:crypto";

export interface CouncilEvidenceInput {
  readonly ref: string;
  readonly contentHash: string;
  readonly content: string;
}

export interface CouncilBriefInput {
  readonly originalRequest: string;
  readonly immutableUserConstraints: ReadonlyArray<string>;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly evidence: ReadonlyArray<CouncilEvidenceInput>;
  readonly clarificationAmendments?: ReadonlyArray<string>;
}

export interface SealedCouncilBrief {
  readonly protocolVersion: 1;
  readonly bytes: string;
  readonly contentHash: string;
}

export const sha256 = (bytes: string): string =>
  `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;

const compareCanonical = (left: unknown, right: unknown): number =>
  JSON.stringify(left).localeCompare(JSON.stringify(right));

export const canonicalJson = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input === null || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalize(entry)]),
    );
  };
  return JSON.stringify(normalize(value));
};

const canonicalStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.map((value) => value.normalize("NFC")))].toSorted();

export const sealCouncilBrief = (input: CouncilBriefInput): SealedCouncilBrief => {
  const body = {
    protocolVersion: 1,
    originalRequest: input.originalRequest.normalize("NFC"),
    immutableUserConstraints: canonicalStrings(input.immutableUserConstraints),
    acceptanceCriteria: canonicalStrings(input.acceptanceCriteria),
    evidence: input.evidence
      .map((item) => ({
        ref: item.ref.normalize("NFC"),
        contentHash: item.contentHash,
        content: item.content.normalize("NFC"),
      }))
      .toSorted(compareCanonical),
    clarificationAmendments: canonicalStrings(input.clarificationAmendments ?? []),
    permissions: [
      "reframe_the_problem",
      "propose_alternatives",
      "request_clarification",
      "report_blocked",
    ],
  } as const;
  const bytes = canonicalJson(body);
  return { protocolVersion: 1, bytes, contentHash: sha256(bytes) };
};
