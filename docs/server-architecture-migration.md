# Server Architecture Inventory

Status: migration complete; current architecture reference
Last reconciled: 2026-08-12 at baseline `96673ccd2ec4769f4719f8f8fc40d11e0f4a1d8d`

The earlier HTTP/WebSocket modularization plan is complete. This file now records the resulting
ownership boundaries; it is not an open migration checklist.

## Current Entry Points

| Area                      | Files                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI/runtime entry         | `apps/server/src/index.ts`, `apps/server/src/main.ts`                                                                                         |
| Runtime layer composition | `apps/server/src/serverLayers.ts`                                                                                                             |
| HTTP routes               | `apps/server/src/http.ts`, `apps/server/src/nodeHttpServer.ts`                                                                                |
| WebSocket RPC routes      | `apps/server/src/wsRpc.ts`, `apps/server/src/wsServer.ts`                                                                                     |
| Current contracts         | `packages/contracts/src/ws.ts`, `packages/contracts/src/ipc.ts`, `packages/contracts/src/server.ts`, `packages/contracts/src/orchestration/*` |
| Current web transport     | `apps/web/src/wsTransport.ts`, `apps/web/src/wsNativeApi.ts`, `apps/web/src/nativeApi.ts`                                                     |

## Protocol ownership

The feature transport uses schema-decoded Effect RPC over WebSocket. Bootstrap and negotiation remain
separate compatibility gates so incompatible clients fail before feature RPC decoding.

| Category          | Compatibility requirement                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Feature RPC       | `WsFeatureRpcGroup`, served by `wsRpc.ts` and consumed by `wsTransport.ts` through Effect RPC schemas. |
| Device RPC        | `WsDeviceRpcGroup`, merged into the authenticated feature socket with the same admission boundary.     |
| Bootstrap         | `WsBootstrapRpcGroup` and HTTP negotiation establish protocol compatibility and short-lived auth.      |
| Push/stream state | Typed orchestration shell/detail streams and server/device streams; snapshot cursors own resync.       |
| Legacy names      | Existing public method/channel constants remain compatibility inputs, not an independent transport.    |

## Local Methods To Preserve

| Category           | Methods                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git                | `git.status`, `git.readWorkingTreeDiff`, `git.summarizeDiff`, `git.createDetachedWorktree`, `git.stashAndCheckout`, `git.stashDrop`, `git.stashInfo`, `git.removeIndexLock`, `git.handoffThread`          |
| Server             | `server.listWorktrees`, `server.getProviderUsageSnapshot`, `server.transcribeVoice`                                                                                                                       |
| Provider discovery | `provider.getComposerCapabilities`, `provider.compactThread`, `provider.listCommands`, `provider.listSkills`, `provider.listPlugins`, `provider.readPlugin`, `provider.listModels`, `provider.listAgents` |
| Project search     | `projects.listDirectories`, `projects.searchLocalEntries`                                                                                                                                                 |
| Push channels      | `server.welcome`, `server.configUpdated`, `server.providerStatusesUpdated`, `terminal.event`, `git.actionProgress`, orchestration channels                                                                |

## Completed HTTP extraction

HTTP-only behavior lives in `apps/server/src/http.ts`; WebSocket upgrade/RPC behavior stays outside
that module. The extraction preserved these externally visible routes:

| Behavior               | Compatibility target                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `/health`              | Preserve current readiness JSON fields.                                             |
| `/api/project-favicon` | Preserve existing favicon lookup and fallback behavior.                             |
| `/attachments/*`       | Preserve ID lookup, relative-path lookup, cache headers, and path traversal checks. |
| Dev mode               | Preserve existing redirect to `devUrl.href`.                                        |
| Static build           | Preserve SPA fallback to `index.html`, MIME lookup, and path traversal checks.      |
| Missing static build   | Preserve `503` response text.                                                       |

## Verification

The current gates are `apps/server/src/http.test.ts`, `wsCompatibility.test.ts`, `wsRpc.auth.test.ts`,
`wsRpc.connectionLifecycle.test.ts`, workspace typecheck, and the stable browser/desktop suites. The
repository technical-debt audit is the current ledger for any remaining transport work.
