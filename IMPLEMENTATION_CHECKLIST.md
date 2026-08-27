# Watchly Local-File Sync implementation checklist

This checklist converts `Watchly_Local_File_Sync_Blueprint.md` into auditable delivery items.

## Phase 0 — dependable rooms

- [x] Direct room links show nickname onboarding.
- [x] Room creation and joining use separate acknowledged events.
- [x] Invalid/expired joins return `ROOM_NOT_FOUND`.
- [x] Room storage uses `Map`.
- [x] Server-generated stable member IDs and hashed resume tokens.
- [x] Protocol-version handshake and blocking refresh UI.
- [x] One controller ID independent of roles, with a 15-second reconnect lease.
- [x] Same-room and payload validation for voice and screen WebRTC signaling.
- [x] Bounded 90-second cold-start/reconnect behavior.

## Phase 1 — local file and readiness

- [x] Browser-local object URLs with replacement/unmount revocation.
- [x] Memory-bounded `sampled-sha256-v1` worker.
- [x] Filename-private descriptor with size and duration.
- [x] Exact fingerprint/size and ±250 ms duration validation.
- [x] Per-member `SELECT_FILE`, `READY`, `MISMATCH`, `UNSUPPORTED`, `ERROR`, and `BUFFERING` states.
- [x] Host readiness panel and explicit start-anyway path.
- [x] Local file data is never accepted by an HTTP or Socket.IO media route.

## Phase 2 — synchronized playback

- [x] Seven-sample server-clock estimate using the median of five lowest-RTT samples.
- [x] Authoritative playback state with `seq`, `commandId`, and scheduled server time.
- [x] Duplicate-command and stale-sequence rejection.
- [x] 750 ms scheduled commands broadcast to every participant including sender.
- [x] Soft 0.97–1.03 correction from 150–750 ms and hard correction above 750 ms.
- [x] Clock refresh on reconnect/foreground and buffering-safe correction.
- [x] Controller-only `ENDED` validation near declared duration.
- [x] Snapshot request for late join and reconnect recovery.
- [x] Rate-limited playback telemetry with position, ready state, buffering, and last sequence.

## Phase 3 — Screen Share Beta

- [x] User-activated `getDisplayMedia` capture with motion hint.
- [x] Separate WebRTC peer connections and authenticated same-room signaling.
- [x] One sharer plus three viewers and 2.5 Mbps video cap.
- [x] Track-ended cleanup and `screen:stopped` propagation.
- [x] Screen sharing remains separate from voice peer connections.
- [x] Missing-audio, permission, autoplay, participant-limit, ICE-restart, and direct-failure UI.

## Verification

- [x] Canonical playback unit tests.
- [x] Socket create/join, invalid join, readiness, controller, sequence, and deduplication integration test.
- [x] Fingerprint determinism, rename independence, content/size mutation, and sampling-boundary tests.
- [x] Resume-within-lease, controller handover, room isolation, and cross-room signaling tests.
- [x] Fifty-socket clock and room snapshot load test.
- [x] ESLint and production build.
- [x] Browser smoke test for room creation, direct-link nickname onboarding, two-session join, and typed expired-room recovery.

## Deployment readiness

- [x] Render Blueprint with backend root, deterministic install/start commands, and `/api/health` health check.
- [x] Production health response with protocol version, uptime, active-room count, and TURN readiness.
- [x] Production configuration preflight for HTTPS origins and coturn REST-secret configuration.
- [x] Comma-separated intentional CORS origins for production and preview frontends.
- [x] Authenticated, per-member, short-lived TURN credentials; the public HTTP endpoint exposes STUN only.
- [x] Vercel SPA rewrite for shared room deep links.
- [x] GitHub Actions verification for backend tests/preflight and frontend tests/lint/build.
- [x] Render/Vercel deployment and release-validation runbook.
- [ ] **Deployment acceptance:** multi-device browser/network matrix with real multi-gigabyte fixtures.
- [ ] **Deployment acceptance:** TURN-relayed Screen Share Beta with configured account-specific credentials.

Checked implementation items mean the code path and available automated checks are present; they do not substitute for the two explicitly unchecked deployment acceptance procedures. Those procedures must pass before production sign-off under the blueprint's Definition of Done.
