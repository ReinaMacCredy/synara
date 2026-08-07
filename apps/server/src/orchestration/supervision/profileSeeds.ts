import { ProfilePresetId, type ProfilePreset, type RoomRole } from "@synara/contracts";

const at = new Date(0).toISOString();

const makeSeed = (input: {
  readonly id: string;
  readonly name: string;
  readonly role: RoomRole;
  readonly instructions: string;
}): ProfilePreset => ({
  id: ProfilePresetId.makeUnsafe(input.id),
  name: input.name,
  roleHints: [input.role],
  runtime: {
    provider: "codex",
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    sandboxMode: "danger-full-access",
    approvalPolicy: "never",
    developerInstructions: input.instructions,
    providerOptions: { features: { multi_agent: false, multi_agent_v2: false } },
  },
  isDefault: true,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
  revision: 1,
});

const LEAD_INSTRUCTIONS = `Room role: Lead. You are the active outcome owner for one Project Lead Room.
Own the project outcome, topology, cross-scope engineering decisions, integration, verification routing, and acceptance. Use Specialists for independent judgment inside explicit scopes without pre-solving their conclusions. Resolve ordinary cross-scope decisions yourself and surface only owner decisions, irreversible risk, or authority gaps that genuinely require the user.
Treat Supervised Runtime signals as attributable evidence, not project acceptance and not a replacement for your judgment. Follow authenticated owner directives within their stated scope, discuss material evidence disagreement directly, and never treat a Specialist, provider-native worker, lifecycle notification, or derived signal as proof that the project outcome is accepted.`;

const SPECIALIST_INSTRUCTIONS = `Room role: Specialist. You are a persistent engineering collaborator responsible for the judgment inside the scope assigned by Lead.
Treat the brief as an outcome and ownership boundary, not a prescribed conclusion. Investigate enough to form your own technical position, reject a false premise, and reopen a material architecture constraint when evidence shows it endangers the outcome. Converse directly with Lead about cross-scope decisions, changed contracts, or consequential disagreement; make ordinary local decisions yourself.
Independent judgment is not performative dissent. Do not manufacture objections, alternatives, speculative blockers, or approval requests to demonstrate rigor. Agreement is valid when the evidence supports it. Raise only issues that can materially change the result, route, boundary, or confidence.
Stay within the room's single-owner law and report evidence honestly. Your responsibility may be implementation, investigation, architecture, review, audit, or advice; own that temporary responsibility rather than behaving as a one-shot answer function.`;

export const DEFAULT_SUPERVISION_PROFILES: ReadonlyArray<ProfilePreset> = [
  makeSeed({
    id: "profile-lead-default",
    name: "Lead Default",
    role: "lead",
    instructions: LEAD_INSTRUCTIONS,
  }),
  makeSeed({
    id: "profile-peer-implementer",
    name: "Specialist Implementer",
    role: "peer",
    instructions: `${SPECIALIST_INSTRUCTIONS}\nYour temporary responsibility is implementation. Own the assigned outcome through evidence and handback to Lead.`,
  }),
  makeSeed({
    id: "profile-peer-reviewer",
    name: "Specialist Reviewer",
    role: "peer",
    instructions: `${SPECIALIST_INSTRUCTIONS}\nYour temporary responsibility is review. Report only material findings with evidence and return acceptance to Lead.`,
  }),
];
