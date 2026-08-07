# Repository Evolution

Last reconciled: 2026-08-07

This map separates current repository evidence, owner statements, and unresolved
product decisions. It is a direction map, not proof that any product behavior is
implemented or shipped.

## Purpose and Users

### Current purpose

Repository documentation describes Synara as both a local-first desktop workspace
for coding with the AI accounts a user already has and an MCP-native agent harness
that lets supported in-app agents coordinate Synara tasks while Codex, Claude, and
other local MCP clients launch and follow scoped work (`README.md:1-12`).

### Current users and consumers

- Developers using chats, terminals, browser previews, diffs, branches, provider
  sessions, worktrees, and handoffs in one local workspace (`README.md:16-23`).
- Supported provider agents running inside Synara and external MCP-capable clients
  connecting to Synara's scoped gateway (`README.md:3-8`).
- Maintainers and release operators consuming the monorepo's build, package, and
  release tooling (`package.json:1-88`, `CHANGELOG.md:29-36`).

These current-purpose statements align with the target vision locked below.

## Current Full Picture

Evidence freshness: inspected 2026-08-06 at `HEAD e8b5b81e` (`main`, 19 commits
ahead of `origin/main`). The 0.6.6 changelog and its verification claims are
repository records, not checks rerun by this evolution pass (`CHANGELOG.md:3-36`).

### Product and runtime ownership

- `apps/server` owns the Node.js WebSocket server, provider sessions, persistence,
  orchestration projection, terminal and browser boundaries, and the Codex-first
  provider path. Repository policy identifies `codex app-server` JSON-RPC over
  stdio as the current session boundary and names
  `codexAppServerManager.ts`, `providerManager.ts`, and `wsServer.ts` as the
  lifecycle, dispatch, and NativeApi owners (`AGENTS.md:90-115`).
- `apps/web` owns the React/Vite session UX, conversation and event rendering,
  settings, activity, transcript behavior, and WebSocket client state
  (`AGENTS.md:92-95`, `apps/web/package.json:1-18`).
- `apps/desktop` owns the Electron shell and packaged desktop runtime
  (`apps/desktop/package.json:1-30`).
- `packages/contracts` owns shared Effect/Schema contracts for provider events,
  WebSocket protocol, orchestration, task processes, supervision, gateway, and
  model/session types. It remains schema-only (`AGENTS.md:94`,
  `packages/contracts/src/taskProcess.ts:1-180`,
  `packages/contracts/src/supervision.ts:1-180`,
  `packages/contracts/src/agentGateway.ts:1-180`).
- `packages/shared` owns runtime utilities shared by server and web through
  explicit subpath exports; it is not a barrel-index package (`AGENTS.md:95`,
  `packages/shared/package.json:1-45`).

### Capability picture

The current source and release record show a broad local agent workspace with:

- Multi-provider sessions and model discovery, with Codex-first app-server
  lifecycle and additional provider runtimes (`AGENTS.md:106-115`,
  `CHANGELOG.md:15-18`).
- Durable orchestration, task/process concepts, provider runtime activity
  projection, lifecycle reconciliation, worktree handoff, checkpoint/revert, and
  turn/control lanes (`CHANGELOG.md:82-99`, `CHANGELOG.md:110-145`).
- Visible-browser automation and annotations, terminal and review surfaces,
  provider-aware runtime modes, approval state, right-dock panes, and resumable
  transport (`CHANGELOG.md:69-108`).
- Advisor/ask-user surfaces, activity/task inbox behavior, forks, and handoffs;
  recent local history includes advisor, orchestrator, activity, and turn-status
  changes (`git log --oneline -- apps/server/src/orchestration apps/server/src/agentGateway apps/web/src/components/settings apps/web/src/components/chat`, inspected 2026-08-06).
- External MCP and agent-gateway contracts with bounded creation and wait plans,
  capability/error schemas, and explicit limits (`packages/contracts/src/agentGateway.ts:1-180`).

### Evidence and lifecycle state

- The workflow home and durable `REPO_EVOLUTION.md` scaffold were added in
  `e8b5b81e`; that commit also removed the two root simulation HTML files. This
  evolve pass did not modify or reinterpret that external commit.
- Seven root asset-only legacy groups are preserved in
  `.spec-workflow/paused/`: `advisor-notes-response-panel`, `orchestrator-mode`,
  `orchestrator-thread-containment-sidebar`, `supervised-orchestration`,
  `supervised-orchestration-settings-redesign`, `task-navigation`, and
  `thread-context-handoff`.
- Each adopted manifest remains `status: paused`, each generated `VERIFY.md`
  remains `PENDING`, and each manifest retains the original `UNALIGNED` reference
  (`.spec-workflow/paused/*/manifest.json`, `.spec-workflow/paused/*/VERIFY.md`).
  The exact root source asset directories remain preserved by the approved copy
  imports.
- `design-qa.md` contains strong visual and focused automated evidence for the
  supervised-orchestration settings redesign and the advisor option-note follow-up
  (`design-qa.md:1-66`, `design-qa.md:129-156`). Its D8 section still identifies a
  standalone design prototype and says production recapture follows implementation
  approval (`design-qa.md:68-127`). This is evidence, not a substitute for each
  bundle's normal VERIFY and ship/handoff proof.
- Owner statement received 2026-08-06: all seven adopted concepts are done and
  shipped. The repository state does not independently encode that completion yet;
  the discrepancy is kept explicit in `GAP-EV-004`.

## Target Vision

Status: LOCKED 2026-08-06 by owner decision.

Synara is a local-first desktop workspace for agent work, with an MCP-native
harness that lets supported agents inside Synara and external local MCP clients
coordinate the same scoped work. Its value is keeping agent work observable,
recoverable, and close to the user's repositories, providers, tools, and history
without requiring a Synara-hosted workspace (`README.md:3-23`, `README.md:39-43`).

**Supervised Mode** is the durable multi-agent operating capability within that
workspace and harness. It replaces the conceptual Orchestrator Mode with a
deterministic Supervised Runtime, Room-owning Leads, bounded Specialists, Task and
TaskNode execution, Durable Context Workspace, RLM, reversible Harness Patches,
retained Specialists, bounded RunPolicy, a background daemon, and governed
JavaScript/Python kernels.
It makes long-running work observable, bounded, recoverable, attributable, and
human-interruptible without adding a second root coordination role or turning the
desktop UI into the runtime owner.

Its control plane is event- and signal-driven: immutable domain/runtime facts feed
rebuildable observations and policy signals; concern-specific subscriptions wake
the scoped Lead path only when relevant operational conditions occur.
Versioned, capability-bounded plugins may extend schemas, metrics, signals, and
delivery handlers without reading canonical storage, expanding authority, or
bypassing the typed command bus and RunPolicy.

This capability supports rather than replaces the local-first workspace and MCP
value proposition. Its clean Supervised shell, deep Room view, and separate
runtime Settings surface progressively disclose operational depth while preserving
the product's restrained interaction model. The canonical target is specified in
`.spec-workflow/active/supervised-orchestration/SPEC.md`; implementation and ship
proof are represented by the active implementation candidate and VERIFY record.

## Gaps

| ID | Current gap | Desired outcome | Evidence | Status |
| --- | --- | --- | --- | --- |
| GAP-EV-001 | Target vision was previously unresolved between workspace-first and orchestration-first framings. | One concise target vision names the primary value, its users, and the supporting role of the other surface. | Owner locked “Local-first workspace + MCP” on 2026-08-06; `README.md:1-23`; current contracts and release history. | CLOSED / owner decision recorded |
| GAP-EV-002 | Supervised Mode is implemented as a local candidate and its controllable UI/runtime paths are verified; the actual GPT-5.6 Luna response is externally blocked by the provider account usage limit, and dated migration adapters remain until the compatibility window closes. | Re-run the bounded Luna response after quota reset, obtain owner acceptance, and retire compatibility adapters when migration evidence permits. | `.spec-workflow/active/supervised-orchestration/SPEC.md`; `.spec-workflow/active/supervised-orchestration/NOTES.md`; `.spec-workflow/active/supervised-orchestration/VERIFY.md`; current contracts/runtime/UI. | OPEN / implementation candidate; external response proof pending |
| GAP-EV-003 | “Missing features from the ChatGPT/Codex app” is an owner-selected Now direction and the baseline is now fixed to ChatGPT Codex app UX, but the feature inventory is not yet named. | A parity matrix names the ChatGPT Codex app UX baseline, missing capabilities, selected outcomes, dependencies, and per-feature acceptance evidence. | Owner selected “ChatGPT Codex app UX” on 2026-08-06; no checked-in parity matrix or owner-approved feature list found during this pass. | OPEN / feature inventory required |
| GAP-EV-004 | Owner says all seven adopted legacy concepts are shipped, while each repository bundle remains paused with `VERIFY.md` pending and an unaligned Evolution reference. | Each claimed-shipped group has independent ship or handoff proof, a completed normal VERIFY, a reconciled Evolution reference, and only then normal archive eligibility. | `.spec-workflow/paused/*/manifest.json`; `.spec-workflow/paused/*/VERIFY.md`; `design-qa.md:1-156`; preserved root assets. | OPEN / proof reconciliation required |
| GAP-EV-005 | Now is selected, but Next and Later product priorities cannot be assigned without expanding the parity feature inventory or orchestration scope. | Owner locks the parity feature set and orchestration scope, after which every active initiative maps to one gap and one outcome horizon. | `REPO_EVOLUTION.md` target and roadmap status; owner decisions on 2026-08-06. | OPEN / sequencing decision required |

## Roadmap

Roadmap items below are outcomes, not a feature backlog. No deadlines are
fabricated.

### Now

#### OUT-NOW-001: Productize orchestration

- Desired outcome: deliver Supervised Mode as the governed Runtime, Lead and
  Specialist system defined by
  `.spec-workflow/active/supervised-orchestration/SPEC.md`, including the clean
  shell, Room view, runtime Settings, daemon-owned recovery, bounded autonomy,
  governed RLM/kernels, reversible learning, programmable Signal & Subscription
  Plane, governed plugins, migration, and legacy cleanup.
- Evidence of completion: owner-approved SPEC; complete bundle VERIFY; real
  Computer Use evidence from product entry points; contract, concurrency,
  recovery, migration, cleanup, load, security, and rollback proof; and no
  unresolved contradiction with the locked target vision.
- Dependencies: `GAP-EV-002`.
- Owner basis: explicit Now choice on 2026-08-06 and Supervised target decisions
  synthesized on 2026-08-07.

#### OUT-NOW-002: Define and deliver selected Codex-app parity outcomes

- Desired outcome: an owner-approved parity matrix identifies what Synara is
  missing relative to the named ChatGPT/Codex app baseline, and selected gaps are
  delivered as bounded outcomes rather than an unbounded imitation effort.
- Evidence of completion: named baseline, selected feature set, per-feature
  acceptance criteria, dependency map, and real entry-point verification.
- Dependencies: `GAP-EV-003`.
- Owner basis: explicit Now direction on 2026-08-06; exact features remain open.

### Next

#### OUT-NEXT-001: Reconcile the seven owner-claimed shipped outcomes

- Desired outcome: the seven paused bundles have evidence-complete VERIFY and
  ship/handoff proof, each Evolution reference is reconciled, and the normal
  lifecycle can determine archive eligibility without guessing.
- Evidence of completion: per-group proof attached to the bundle, preserved-source
  and receipt checks still pass, VERIFY is `PASS`, and the lifecycle engine accepts
  the normal finalization dry-run. This is a workflow-evidence outcome, not a
  product reprioritization.
- Dependencies: `GAP-EV-004`, and the owner-provided ship/handoff evidence for
  each group.

### Later

No additional product outcomes are assigned yet. Further horizon choices remain
blocked intentionally by `GAP-EV-003` and `GAP-EV-005`. The seven
legacy sources and paused bundles remain preserved; no unselected concept is
silently promoted or discarded.

## Invariants and Non-goals

### Invariants

- Performance and reliability remain first-order constraints; behavior must stay
  predictable under load, session restart, reconnect, partial streams, and provider
  failure (`AGENTS.md:18-24`).
- Synara remains local-first: repositories, chats, and history stay on the user's
  machine, while the selected provider receives only the session material needed
  for the chosen work (`README.md:39-43`).
- Provider runtime state, orchestration state, and UI state must converge through
  explicit lifecycle identity and durable projections; late, replayed, interrupted,
  and restarted events cannot be treated as fresh completion without evidence
  (`CHANGELOG.md:82-99`, `CHANGELOG.md:110-145`).
- `apps/server`, `apps/web`, `apps/desktop`, `packages/contracts`, and
  `packages/shared` keep their ownership boundaries; contracts stay schema-only and
  shared runtime code uses explicit subpath exports (`AGENTS.md:90-95`).
- Transcript auto-follow counts real transcript messages, not tool rows or generic
  activity, and shared disclosure motion remains the single toggle-motion source
  (`AGENTS.md:66-88`).
- Legacy evidence is lossless: preserve all seven paused bundles and all seven root
  source asset directories. A user statement of shipment does not replace a normal
  VERIFY and ship/handoff proof.
- Supervised runtime authority and long-running lifecycle live in the background
  daemon and durable journal, never in desktop UI connection state.
- Autonomous execution is bounded by immutable per-Run policy snapshots; learned
  Harness Patches cannot alter base policy or expand permissions.
- Immutable facts, rebuildable metrics, durable policy signals, and typed commands
  remain separate. Subscriptions wake the scoped Lead path with evidence but do
  not confer authority; plugins are capability-bounded and cannot block or bypass
  the durable control plane.
- Final Supervised UI acceptance includes real Computer Use against the visible
  running product, and target cutover removes obsolete code and tests rather than
  preserving parallel legacy behavior indefinitely.
- The current implementation candidate includes product code, migrations, focused
  tests, production builds and Computer Use evidence. It is not owner-accepted or
  archived while the external Luna response assertion remains blocked.

### Non-goals

- Do not infer the target vision, Codex-app parity feature list, deadlines, or
  product priority from filenames, current implementation breadth, screenshots,
  changelog age, or the existence of a shipped-looking surface.
- Do not treat the seven paused bundles as verified or archived in this pass.
- Do not turn the Now outcomes into an implementation plan until their scope and
  acceptance decisions are locked.

## Evolution Log

- **2026-08-07 — one Supervised product implemented and exercised:** Owner retired
  the duplicate root coordination abstraction. The canonical product now has a
  deterministic Supervised Runtime, Lead and Specialist actors, optional bounded
  recursive Leads, shared Editor Workspace motion, Signal Plane, governed plugins
  and two Settings surfaces. Computer Use verified the controllable product flow,
  GPT-5.6 Luna + Low propagation, Room Workspace, synthetic subscription preview
  and runtime diagnostics. The provider usage limit blocks only the generated
  response assertion; `GAP-EV-002` remains open for that external proof, owner
  acceptance and later compatibility retirement.

- **2026-08-07 — Signal & Subscription Plane made foundational:** Owner clarified
  that control-plane events must cover domain/runtime facts, derived metrics,
  policy conditions, scoped Lead wake subscriptions, and governed plugin handlers,
  not only agent lifecycle. The canonical draft now includes review-loop and Lead
  context-pressure use cases, declarative subscription contracts, event schemas,
  at-least-once delivery, replay/DeadLetter semantics, plugin lifecycle/security,
  UI/Settings, cleanup, and verification. The existing prototype predates these
  signal-specific surfaces; those surfaces are now implemented and exercised in
  the product candidate.

- **2026-08-07 — Supervised Mode target synthesized:** Owner decisions, current
  Synara ownership/contracts, the approved interactive prototype, official Prime
  Agent/RLM sources, owner-provided analyses, and preserved legacy assets were
  consolidated into one draft canonical SPEC and verification contract. The
  vision now names the governed Runtime/Lead/Specialist target, Room view, separate runtime Settings,
  legacy code/test cleanup, and required real Computer Use UI acceptance. This is
  design evidence only; `GAP-EV-002` remains open pending owner approval,
  implementation, and proof.

- **2026-08-06 — workflow adoption and current-state reconciliation:** The
  repository workflow home was added in `e8b5b81e`; seven root asset-only groups
  were copied losslessly into paused bundles with the reviewed inventory identity
  and preserved sources. All seven remain `VERIFY: PENDING`.
- **2026-08-06 — owner direction recorded:** Owner stated that all seven adopted
  concepts are already done and shipped, selected orchestration productization plus
  missing ChatGPT/Codex app features for Now, and then locked the target vision to
  the local-first workspace plus MCP framing and the parity baseline to ChatGPT
  Codex app UX. The evidence contradiction is preserved as `GAP-EV-004`; no bundle
  was finalized.

## Next Reconciliation Trigger

Reconcile this map when the owner accepts or materially revises the Supervised
Mode candidate, when the blocked Luna response evidence advances, when the
owner names the ChatGPT Codex app parity features, or when independent ship/handoff
evidence is attached for one or more of the seven paused bundles. Until then, keep
`GAP-EV-002`, `GAP-EV-003`, `GAP-EV-004`, and `GAP-EV-005` visible and do not claim
roadmap completion.
