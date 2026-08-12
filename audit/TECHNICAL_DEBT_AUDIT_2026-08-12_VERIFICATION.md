# Technical-debt audit shipment verification

- Date: 2026-08-12
- Audit commit: `a1962b547fc08db53360829763255a154e8267bb`
- Baseline: `96673ccd2ec4769f4719f8f8fc40d11e0f4a1d8d` (`origin/main`)
- Branch: `codex/ship-technical-debt-audit`

## Remediation shipment update

The owner superseded the original report-only scope after the baseline pass and authorized the full
audit backlog plus all observed shipment failures in this same branch and PR #1. The historical
verification below is retained because it is the reproduction evidence. Current remediation and
final rerun results are recorded here.

### Current remediation command matrix

| Command or gate                                                                                                 | Current result | Evidence                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun fmt`                                                                                                       | PASS           | Final post-acceptance rerun formatted 2,804 files; `bun run fmt:check` then confirmed all 2,804 files.                                                                                                                                 |
| `bun lint`                                                                                                      | PASS           | Final post-acceptance rerun completed across 2,694 files with 0 errors and 535 warnings.                                                                                                                                               |
| `bun typecheck`                                                                                                 | PASS           | Final post-acceptance rerun passed 7/7 workspace tasks in 31.025s.                                                                                                                                                                     |
| `bun run brand:check`                                                                                           | PASS           | No retired first-party product identity remains.                                                                                                                                                                                       |
| `bun run migrations:check`                                                                                      | PASS           | Every released migration ID/name pair matches across 81 inspected tags.                                                                                                                                                                |
| `bun run compatibility:check`                                                                                   | PASS           | No production writer can emit the legacy Supervised vocabulary.                                                                                                                                                                        |
| `bun run build`                                                                                                 | PASS           | 5/5 production build tasks passed. Turbo emitted a nonfatal sandbox `Operation not permitted` cache-I/O diagnostic after the successful graph and exited 0.                                                                            |
| `bun run build:desktop`                                                                                         | PASS           | 4/4 desktop build tasks passed with the same nonfatal post-graph Turbo cache diagnostic and exit 0.                                                                                                                                    |
| preload bundle existence/export inspection                                                                      | PASS           | `apps/desktop/dist-electron/preload.js` exists and contains the desktop bridge, WebSocket URL, and folder-picker channel exports.                                                                                                      |
| `bun run release:smoke`                                                                                         | PASS           | The unrestricted run passed the isolated-install and release workflow checks. Its sandboxed precursor failed only because Bun could not create a temporary directory, not because of repository behavior.                              |
| macOS arm64 DMG package command                                                                                 | PASS           | Emitted a 230 MiB DMG, 232 MiB ZIP, `latest-mac.yml`, and builder diagnostics under `/private/tmp/veylen-audit-artifact-ship-final`; SHA-256 values are `de817634...4951d47` and `cd22e62e...de8ec98`.                                 |
| `bun run test`                                                                                                  | PASS           | Authoritative unrestricted rerun: 8/8 Turbo tasks passed in 14m44.474s. The CLI/server corpus reported 399 passed files, 3 skipped files, 3,976 passed tests, and 16 skipped tests; the web corpus reported 336 files and 3,917 tests. |
| `bun run --cwd apps/web test:browser:stable`                                                                    | PASS           | 59 files; 292 passed and 11 skipped tests in 413.08s.                                                                                                                                                                                  |
| `bun run --cwd apps/web test:browser:geometry`                                                                  | PASS           | Blocking geometry selection: 1 passed and 58 skipped files; 11 passed and 292 skipped tests in 221.55s.                                                                                                                                |
| `bun run --cwd apps/web test:electron:e2e`                                                                      | PASS           | Both annotation and persistent visible-Browser MCP tests passed in 22.5s after the visible fixture was insulated from ambient workstation pointer input.                                                                               |
| `bun run test:desktop-smoke`                                                                                    | PASS           | Desktop smoke launched the packaged application and passed all 5 graph tasks in 3m39.918s.                                                                                                                                             |
| `bun run release:smoke:mac-update -- --artifact-dir /private/tmp/veylen-audit-artifact-ship-final --port 58149` | PASS           | ZIP and update manifest were served and validated; `Content-Length` matched 242,861,810 bytes, and obsolete blockmap removal was confirmed.                                                                                            |
| isolated built-in in-app Browser acceptance                                                                     | PASS           | Real Veylen on isolated server/web ports exercised New Chat, Add Project/cancel, Settings/Appearance, Kanban, Source, and Pull Requests. No `_nonReactive`, preload, or console error log was captured.                                |

### Verified remediation evidence to date

| Surface                   | Result    | Evidence                                                                                                                                                                                                                                                                                       |
| ------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 runtime-event append | PASS      | File-backed WAL/NORMAL benchmark at 5,000 events: legacy unique p50 916.3 ms; atomic upsert unique p50 713.2 ms. Duplicate/error semantics remain covered by six repository tests.                                                                                                             |
| S-02 long transcript      | PASS      | With a 96-row initial history window, 10,000 messages held at 404 DOM nodes, 16.8 ms scroll p95, and 25.1 ms streaming p95, compared with about 20,300 nodes and 575.8/308.3 ms at baseline.                                                                                                   |
| S-03 stale reconciliation | PASS      | At 100,000 threads: indexed candidate-first p50 0.186 ms versus 51.67 ms legacy; the query plan uses all three partial indexes. Forty migration/query tests and server typecheck passed.                                                                                                       |
| S-04 packaged ACP soak    | DISPROVEN | The 7,200,349.827 ms packaged official-SDK mock-boundary soak completed 28,081 prompts across 24 cycles and 240 samples. Every subprocess exited; host RSS grew 10,813,440 bytes and child RSS grew 14,729,216 bytes, both below the 33,554,432-byte threshold; queue maxima were 1/0/0.       |
| ACP regression            | PASS      | Unrestricted `bun run --cwd apps/server test src/provider/acp/AcpJsonRpcConnection.test.ts src/provider/acp/AcpSessionRuntime.test.ts`: 2 files, 31 tests passed. The sandboxed attempt failed only because descendant capture was unavailable (`rootExited=true`, `captureComplete=false`).   |
| Router preload            | PASS      | `usePreloadRouteChunks` now calls `loadRouteChunk` rather than speculative `preloadRoute`; focused tests, web typecheck, and final in-app Browser navigation all passed with no `_nonReactive` or preload console entries.                                                                     |
| Desktop packaging         | PASS      | The formerly failing macOS arm64 command completed and emitted a 230 MiB DMG, 232 MiB ZIP, `builder-debug.yml`, and `latest-mac.yml` to `/private/tmp/veylen-audit-artifact-ship-final`. Focused publish-config tests (3), mac config tests (8), scripts typecheck, and mac update smoke pass. |

The complete unit/build/browser/Electron/release matrix and final built-in in-app Browser acceptance
are green. The next section records the first, pre-remediation reproduction pass.

### Final built-in in-app Browser acceptance

Acceptance used the Codex/ChatGPT built-in in-app Browser against a real isolated Veylen instance,
not external Chrome, standalone Playwright, source inspection, or generic Computer Use.

- Dry-run and launch used `VEYLEN_AUTH_TOKEN` unset, `VEYLEN_PORT_OFFSET=210`,
  `VEYLEN_NO_BROWSER=1`, `/private/tmp/veylen-debt-final`, server `127.0.0.1:58240`, and web
  `127.0.0.1:5943`. Both listeners were confirmed before acceptance and closed after the intentional
  shutdown.
- The Browser reached the branded `Veylen (Dev)` New Chat shell and rendered the real composer,
  provider, access, effort, Environment, and editor controls.
- Sidebar navigation rendered Kanban's zero-task board, Source's no-project guidance, Pull Requests'
  open/all empty state, and Settings/Appearance's theme, typography, density, font, and time controls.
- Add Project rendered Folder/GitHub source choices, path and Space controls, then cancelled cleanly
  without adding a project.
- Browser developer logs contained no console errors and no entries matching `_nonReactive` or
  `preload` after the navigation sequence.
- Transient screenshot evidence is preserved at `/private/tmp/veylen-debt-final-home.png` and
  `/private/tmp/veylen-debt-final-settings.png`. The in-app Browser tab was finalized after the
  evidence was captured.

## Original report-only outcome

The audit deliverable passes its report-only acceptance boundary: the 867-line report remains the
only production-repository deliverable, its original commit is preserved, and no production code was
changed. The repository-wide release gate is **blocked by baseline production failures** found in
format, brand, migration-lineage, typecheck, Chromium browser, Electron E2E, package, and live-app
console checks. Those failures were diagnosed and recorded without remediation, as required by the
audit scope.

## Environment and isolation

- Dependencies: `bun install --frozen-lockfile` installed 2,529 packages in this worktree and left
  `bun.lock` and all manifests unchanged.
- Toolchain observed: Bun 1.3.14, Node.js 22.22.3. The root manifest pins Bun 1.3.12.
- Real app: server `127.0.0.1:58140`, web `127.0.0.1:8974`, isolated data root
  `/private/tmp/veylen-audit-ship`, `VEYLEN_AUTH_TOKEN` unset, browser auto-open disabled.
- Both ports were confirmed free before launch, listening during acceptance, and closed after the
  process received an intentional interrupt.
- The user's main checkout and local `main` branch were not modified.

## Automated verification

| Command                                                                                                                                                    | Outcome                  | Classification and evidence                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                                                                                            | PASS                     | 2,529 packages installed; lockfile and manifests unchanged. The first sandboxed attempt could not write its temp directory; the approved unrestricted rerun passed.                                                                                                                                                                                                                       |
| `bun fmt`                                                                                                                                                  | PASS                     | Formatted 2,776 files in 1,067 ms. It exposed six baseline production files that differ from the formatter. Those command-created production edits were reverted exactly; only the task-owned audit report retained formatting.                                                                                                                                                           |
| `bun run fmt:check`                                                                                                                                        | FAIL                     | Baseline: six production files fail formatting: `MessagesTimeline.logic.ts`, `MessagesTimeline.tailAnchor.browser.tsx`, `MessagesTimeline.tsx`, `TimelineWorkEntryRow.tsx`, `cadenced-shimmer.css`, and `turnWorkStatus.ts`.                                                                                                                                                              |
| `bun lint`                                                                                                                                                 | PASS                     | 0 errors, 534 warnings across 2,668 files.                                                                                                                                                                                                                                                                                                                                                |
| `bun typecheck`                                                                                                                                            | FAIL                     | Baseline: `apps/web/src/components/chat/MessagesTimeline.tailAnchor.browser.tsx:72-73` has TS1360/TS2339 because the constructed union value does not satisfy `TimelineEntry` and `message` is not present on every variant. Five of six Turbo tasks succeeded.                                                                                                                           |
| `bun run test`                                                                                                                                             | PASS                     | The approved unrestricted rerun completed all 8 workspace tasks in 8m0.414s; 8/8 successful, 2 cached. The CLI/server corpus reported 397 passed files, 3 skipped files, 3,969 passed tests, and 16 skipped tests; the web corpus reported 334 passed files and 3,910 passed tests. The initial sandboxed run failed only on denied loopback listeners and is not a repository failure.   |
| `bun run brand:check`                                                                                                                                      | FAIL                     | Baseline: retired first-party identity remains in `apps/web/src/components/chat/MessagesTimeline.logic.test.ts:1311`. A historical brand phrase in the task-owned report was corrected before this final run.                                                                                                                                                                             |
| `bun run migrations:check`                                                                                                                                 | FAIL                     | Baseline: released tags record migration 88 as `ProjectionThreadsSettledAt` while current source records `OrchestratorMode`; released tags record migration 89 as `RecoverRetentionHiddenThreads` while current source records `ProjectionThreadsSettledAt`.                                                                                                                              |
| `bun run build`                                                                                                                                            | PASS                     | All five applicable Turbo build tasks succeeded; contracts, marketing, desktop, web, and CLI artifacts were produced or replayed from the worktree cache.                                                                                                                                                                                                                                 |
| `bun run build:desktop`                                                                                                                                    | PASS                     | Desktop/CLI build graph succeeded, 5/5 tasks.                                                                                                                                                                                                                                                                                                                                             |
| preload bundle existence and exported-bridge search                                                                                                        | PASS                     | The generated preload exists and exposes `desktopBridge.getWsUrl`; the `desktopBridge`, `getWsUrl`, `PICK_FOLDER_CHANNEL`, and `wsUrl` search terms matched the bundle.                                                                                                                                                                                                                   |
| `bun run test:desktop-smoke`                                                                                                                               | PASS                     | Electron desktop launched and the smoke test reported `Desktop smoke test passed`; 5/5 graph tasks succeeded.                                                                                                                                                                                                                                                                             |
| `bun run release:smoke`                                                                                                                                    | PASS                     | Release smoke checks passed after an approved unrestricted rerun; the sandboxed attempt failed only because its temporary lockfile workspace was not writable.                                                                                                                                                                                                                            |
| `bun run --cwd apps/web test:browser:install`                                                                                                              | PASS                     | Required Chromium installation/check completed. The sandboxed attempt stalled under restricted network access; the approved unrestricted rerun returned successfully.                                                                                                                                                                                                                     |
| `bun run --cwd apps/web test:browser:stable`                                                                                                               | FAIL                     | Baseline: 2 failed / 57 passed files; 7 failed / 284 passed / 11 skipped tests. Failures are in `ChatView.browser.tsx` and `MessagesTimeline.toolGroupCollapse.browser.tsx`, centered on Working-to-Worked state, work-region identity, timing text, reasoning rows, and optimistic follow-ups.                                                                                           |
| `bun run --cwd apps/web test:browser:geometry`                                                                                                             | FAIL (nonblocking in CI) | Baseline: 1 failed / 58 skipped files; 8 failed / 3 passed / 291 skipped tests. The Linux geometry cases did not render target user rows in the expected virtualized region.                                                                                                                                                                                                              |
| `bun run --cwd apps/web test:electron:e2e`                                                                                                                 | FAIL                     | Baseline: both tests failed. Browser annotations committed `comment: null` instead of `Make this action clearer`; the visible-browser MCP case failed with `BrowserStaleReference`. Playwright retained screenshots and traces under the ignored `apps/web/test-results` directory.                                                                                                       |
| `bun run dist:desktop:artifact -- --platform mac --target dmg --arch arm64 --output-dir /private/tmp/veylen-audit-artifact-verbose --skip-build --verbose` | FAIL                     | Baseline packaging configuration: Electron Builder created the unsigned arm64 app, ZIP, DMG, and blockmap in staging, then update-info generation crashed with `Cannot read properties of null (reading 'channel')`. Electron Builder also reported that it could not infer a repository from the staged `.git/config`. No release artifact was copied to the requested output directory. |

## Original in-app Browser acceptance

Acceptance used the built-in Codex/ChatGPT in-app Browser against the running isolated Veylen app,
not external Chrome, standalone Playwright, source inspection, or generic Computer Use.

- The app loaded as `Veylen (Dev)` and projected an isolated empty state with no projects or chats.
- The primary shell rendered Veylen branding plus New thread, Kanban, Source, Pull requests,
  Automations, Settings, and Help controls.
- `/source` rendered the user-facing `No project selected` state and the guidance to add a local
  project.
- New thread with no project opened the real `Add project` dialog with Folder/GitHub source choices,
  project path, Space, Add project, Cancel, and Close controls; it was cancelled without mutation.
- `/settings?section=appearance` rendered theme selection, dark/light theme controls, typography,
  density, font-size, smoothing, and time-format settings. The settings search accepted `density` and
  returned `Appearance` and `UI density` results.
- No visible render or navigation failure occurred on those acceptance paths. The browser console did
  record two identical baseline TanStack Router preload errors: `Cannot read properties of undefined
(reading '_nonReactive')` from `loadRouteMatch` while navigating settings.
- Screenshots were captured to `/private/tmp/veylen-audit-inapp-shell.png` and
  `/private/tmp/veylen-audit-inapp-appearance.png` as local transient evidence. The in-app Browser tab
  was finalized and its temporary viewport override was reset after acceptance.

## Original audit-deliverable checks

- The report remains 867 lines and contains 16 confirmed findings plus 4 suspected candidates.
- The formatter changed table presentation only; finding IDs, severity, confidence, evidence paths,
  remediation ordering, counts, and conclusions were not changed.
- The only substantive report correction replaces a retired historical brand phrase with
  `Historical pre-rebrand and Veylen audits`, allowing the final brand check to isolate the remaining
  production-owned failure.
- Final staging must contain only this record and the task-owned audit report; production files,
  generated test output, build output, workflow state, and transient screenshots are excluded.

## Original report-only verdict

**At the pre-remediation checkpoint: AUDIT DELIVERABLE PASS; REPOSITORY BASELINE BLOCKED.**

The audit is ready for review in a pull request with the baseline failures disclosed. Fixing those
failures would modify production code or broaden the technical-debt audit, so no remediation is
included in this branch.
