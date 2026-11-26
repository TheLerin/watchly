> Historical migration baseline. Current V2.1 changes, unresolved issues and evidence are in [REMEDIATION_REPORT.md](REMEDIATION_REPORT.md), [TEST_REPORT.md](TEST_REPORT.md) and [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Counts and architecture details below describe the earlier migration, not the complete current source.

# Watchly Cloudflare migration report

Date: 2026-11-26. Starting revision: `d3f1562c939b0b9ac0dc4ee5dff3e164431ac8c6`.

## Outcome

The Cloudflare implementation and deployment preparation are in the repository. **This is not a production-verified migration or an authorization to retire the existing hosts.** No production deployment, DNS change, billing activation, database migration or deletion of existing services was performed.

The original React presentation, Supabase project/schema and LiveKit media implementation remain. Workers Static Assets serve the SPA; Workers route APIs and room social previews; a deterministic SQLite Durable Object owns each room. Native WebSockets retain the application's existing event names through a transport adapter; the domain reducers are shared with the rollback server.

## Implemented

- Persistent room membership/resume hashes, permissions, chat history, queue, local/remote playback and YouTube playlist state; alarm-based host/coordinator lease and empty-room cleanup.
- Hibernation WebSockets, connection attachments, auto-response heartbeats, protocol/version/sequence checks, bounded duplicate-ID/command handling, durable mutation ACK metadata, reconnect jitter and authoritative snapshot recovery. Room IDs and socket IDs are separate; native IDs preserve the existing 32-character signaling constraint.
- Indexed cross-room friend presence through a private directory, with friend-authorized lookups and bounded alarm notification batches. Persistent social data stays in Supabase with unchanged RLS.
- Final presence-recovery correction: deferred social refresh deadlines now persist with connection metadata and are restored after object eviction; refresh also rechecks the current authorized friend list. The updated 20-test Worker suite passes this regression. The earlier workspace-permission interruption is resolved.
- Worker-compatible LiveKit participant tokens and narrow server RoomService calls using WebCrypto/Fetch. Kicks persist media removal jobs and retry failed removals after eviction; signed webhooks remove stale/banned media joins. Future SFU implementations have explicit server and frontend adapter boundaries. Cloudflare Realtime is disabled and not provisioned.
- Existing P2P screen sharing remains. An SFU could reduce the sharer's repeated uploads and centralize media management, but would change screen-track grants, shared track ownership and quota usage. Without verified cost/headroom and real-device regressions, keeping the existing path meets the no-cost/no-regression constraint.
- Room-authorized Drive cookies, selected-file checks, streaming Fetch delivery, Range/206/HEAD/416 preservation and redirect SSRF protection. Provider restrictions stay errors. A fixed-origin legacy adapter preserves the existing Render path when direct Drive access is blocked.
- Central API/transport configuration, SPA routing, public metadata, asset caching, PWA exclusions, isolated local/staging/production configuration, CI verification and an explicitly dispatched staging deployment.
- Security, cost, feature parity, deployment and rollback documentation, plus the complete original event inventory in `shared/event-map.json`.

## Background video correction

No chunked delivery was implemented. FFmpeg re-encoded the full existing approximately 96-second desktop/mobile loops, removed audio, preserved aspect ratio and added fast-start H.264 fallback plus VP9 alternatives. Desktop output is 30 fps rather than the original 60 fps; mobile remains 30 fps. The original cut/timing is retained to output-frame precision. Posters, viewport/visibility loading, reduced-motion and data-saver fallback are implemented, and background video is excluded from eager PWA precaching.

| Asset | Original bytes | Optimized bytes |
|---|---:|---:|
| Desktop H.264 MP4 | 40,163,902 | 4,591,931 |
| Desktop VP9 WebM | Same original | 4,711,520 |
| Mobile H.264 MP4 | 13,611,730 | 1,827,854 |
| Mobile VP9 WebM | Same original | 1,885,121 |

All deployed static files pass the below-25-MiB build check. FFmpeg diagnostics/SSIM at output resolution are recorded in `docs/background-optimization.json` and `docs/background-webm-optimization.json`; those metrics are diagnostics, not a claim of lossless encoding. Representative decoded frames were inspected. Re-encoding should start from the originals retained in the starting Git revision, not repeatedly compress the optimized files.

## Verification results

| Check | Result | Evidence and boundary |
|---|---|---|
| Frontend unit suite | **124 passed** | Includes existing account, playlist, local-media, synchronizer, social, sounds and new native transport/usage tests |
| Worker/SQLite harness suite | **20 passed** | Room/auth/permissions/isolation/chat/queue, local commands, playlist, signal relays, eviction/restore, host leases, cleanup, cross-room presence, duplicate/replay checks, API/Drive fixtures, JWT/webhook signatures and durable failed media-removal retry |
| Focused backend Auth/playback/PostgreSQL/RLS suites | **20 passed** | Real PGlite/PostgreSQL schema/RLS tests; no production database access |
| Frontend ESLint | **Passed** | Existing rules retained |
| Cloudflare frontend production build and asset bound | **Passed** | Native/same-origin build; all assets below 25 MiB |
| Worker esbuild bundle | **Passed** | Bundling only; does not validate real Worker runtime APIs |
| Chromium UI with SQLite lifecycle/network harness | **Passed** | Actual frontend/native browser transport: two-user create/join/chat, direct routes, local-file fingerprint/readiness/play/pause/seek, reconstructed room, mobile layout and reduced-motion poster; test-only intercepted networking |
| Full legacy backend suite | **Attempted: 21 passed, 37 failed** | Loopback HTTP/WebSocket connections are denied by this execution environment (`connect EACCES 127.0.0.1`), including a minimal standalone connection probe. Initial baseline failed for the same reason. These failures were not disabled or relabeled as passes |
| Real Wrangler/workerd dry run/integration/browser suite | **Blocked** | npm registry lookup fails `ENOTFOUND`; offline installation has no cached Wrangler. The real-runtime scripts fail clearly when Wrangler is missing |
| Local connection load script | **Blocked** | Loopback connection denied. No throughput or production capacity result claimed |
| Live OAuth/email, actual Supabase services | **Not externally verified** | Requires real project credentials/configuration and reachable services |
| Live Drive seeking/provider restrictions | **Not externally verified** | Streaming/access checks have fixtures; real files/provider delivery need staging verification |
| LiveKit calls, server-side removal/rejoin and signed delivery | **Not externally verified** | SDK verifies token construction and test fixtures verify server request/job logic; real media server/admin API/webhook need credentials and two devices |
| Real screen capture, NAT/TURN and hardware/mobile browsers | **Not externally verified** | Existing implementation retained; protocol/capture lifecycle tests are not real network/device verification |

The focused suites total 164 passing tests. This number is not the result of the full legacy network suite and does not replace the failed/blocked checks above. Browser harness results do not prove workerd hibernation, network performance or external provider behavior.

## Services and configuration

Still required: Cloudflare Workers + SQLite Durable Objects for the new deployment; existing Supabase Auth/PostgreSQL/social Realtime/storage; existing LiveKit for microphone/camera; STUN and existing TURN where NAT requires relay. Render remains required if the isolated Drive adapter is used or legacy rooms are still active.

Safe to discontinue **now: none**. After successful staging, approved cutover and room draining, Vercel can be retired. Render can be retired only after native APIs/signaling pass full parity and real Drive verification succeeds without the legacy adapter. Supabase and LiveKit are intentionally retained.

Provide the existing Supabase URL/publishable key, backend-only service-role key for invites, LiveKit URL/API key/API secret, and a new independent media-cookie signing secret. Provide coturn URLs/shared secret if relay is needed; configure the existing LiveKit signed webhook endpoint. Wrangler login and a Cloudflare account are needed for deployment; GitHub credentials are optional. Exact commands and secret sources are in `CLOUDFLARE_DEPLOYMENT.md`.

The **next deployment command**, after dependency installation, secret setup and real local/runtime gates pass, is:

```powershell
npm run deploy:staging
```

Do not run production deployment or change DNS until approved. No root lockfile could be generated without registry access; generate and commit it after a successful `npm install` and real-runtime verification.

## Remaining limitations and billing risks

- Actual workerd compatibility/hibernation is a release gate; Node compatibility and a successful bundle alone are insufficient evidence.
- LiveKit Cloud removal revokes participant tokens; self-hosted LiveKit does not provide the same token invalidation. Short TTL and signed join-webhook cleanup are reactive, not a zero-packet admission guarantee. Provider outages delay removal despite durable retries. See `SECURITY_REVIEW.md`.
- Guest access remains room-code based, and a kicked guest's membership ban does not prevent an unrelated new guest identity from using a leaked code. Room histories/bans expire with the room.
- No guaranteed zero monthly total: storage writes, active DO duration, Supabase Realtime/egress and media provider allowances are separate limits. The documented 5,000-DAU model exceeds Free quotas. Optional client byte estimates are not hard billing caps.
- Direct Drive delivery is subject to provider access restrictions. The legacy adapter preserves compatibility but retains Render until it can be removed after real verification.
- Native and Socket.IO rooms cannot share live authoritative state. Existing rooms need to drain/rejoin at cutover; accounts and persistent Supabase records remain unchanged.

## File inventory

The inventory below includes this migration's tracked modifications and new deliverables. The two pre-existing untracked user images were excluded and untouched. No tracked files were removed.

### Modified

- `.gitignore`
- `backend/accounts.js`
- `backend/livekitVoice.js`
- `backend/realtime.js`
- `backend/server.js`
- `frontend/.env.example`
- `frontend/public/bg-video-mobile.mp4`
- `frontend/public/bg-video-poster.jpg`
- `frontend/public/bg-video.mp4`
- `frontend/social-preview/metadata.js`
- `frontend/src/components/FloatingVideoCall.jsx`
- `frontend/src/components/LandingPage.jsx`
- `frontend/src/components/LiveKitMediaProvider.jsx`
- `frontend/src/components/LiveKitVoiceRoom.jsx`
- `frontend/src/components/VideoCallPanel.jsx`
- `frontend/src/components/VideoPlayer.jsx`
- `frontend/src/context/RoomContext.jsx`
- `frontend/src/hooks/useScreenShare.js`
- `frontend/src/hooks/useServerClock.js`
- `frontend/src/socket.js`
- `frontend/test/browserPlayback.cjs`
- `frontend/vite.config.js`

### Added

- `.dev.vars.example`
- `.env.example`
- `.github/workflows/cloudflare.yml`
- `CLOUDFLARE_AUDIT.md`
- `CLOUDFLARE_DEPLOYMENT.md`
- `COST_ANALYSIS.md`
- `FEATURE_PARITY.md`
- `MIGRATION_REPORT.md`
- `README.md`
- `SECURITY_REVIEW.md`
- `backend/livekitIdentity.js`
- `docs/background-optimization.json`
- `docs/background-webm-optimization.json`
- `frontend/public/_headers`
- `frontend/public/bg-video-mobile-poster.jpg`
- `frontend/public/bg-video-mobile.webm`
- `frontend/public/bg-video.webm`
- `frontend/src/components/LandingBackgroundVideo.jsx`
- `frontend/src/config.js`
- `frontend/src/hooks/useDriveSession.js`
- `frontend/src/media/livekitAdapter.js`
- `frontend/src/media/provider.js`
- `frontend/src/utils/mediaProvider.js`
- `frontend/src/utils/mediaUsage.js`
- `frontend/src/utils/nativeTransport.js`
- `frontend/test/mediaUsage.test.js`
- `frontend/test/nativeTransport.test.js`
- `package.json`
- `scripts/build-cloudflare.mjs`
- `scripts/optimize-backgrounds.py`
- `scripts/prepare-assets.mjs`
- `shared/event-map.json`
- `shared/protocol.md`
- `workers/src/PresenceDirectory.mjs`
- `workers/src/WatchRoom.mjs`
- `workers/src/drive.mjs`
- `workers/src/index.mjs`
- `workers/src/media.mjs`
- `workers/src/runtime.mjs`
- `workers/test/api.test.mjs`
- `workers/test/browser-harness.mjs`
- `workers/test/browser.cjs`
- `workers/test/client.mjs`
- `workers/test/features.test.mjs`
- `workers/test/harness.mjs`
- `workers/test/integration.mjs`
- `workers/test/load.mjs`
- `workers/test/local-server.mjs`
- `workers/test/media.test.mjs`
- `workers/test/presence.test.mjs`
- `workers/test/room.test.mjs`
- `wrangler.jsonc`

### Removed

None.

