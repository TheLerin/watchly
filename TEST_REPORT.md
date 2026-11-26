# Test report — 26 November 2026

The verifier records exact results in docs/verification.json and retains failure logs locally. It exits nonzero when a required check fails. Tests were not skipped, weakened or relabeled to obtain a green result.

| Check | Result | Scope / boundary |
|---|---|---|
| workers | PASS (47/47) | Node/SQLite lifecycle + failure/security tests |
| backend-focused | PASS (27/27) | Auth, RLS/PGlite, session RPC, playback, validation, Drive and limits |
| frontend | PASS (134/134) | Pure browser-domain utilities/recovery/media/clock/adapters |
| frontend-lint | PASS | ESLint |
| build | PASS | Production Vite/PWA build |
| asset-validation | PASS | Asset/cache validation |
| worker-bundle | PASS | esbuild packaging only |
| browser-harness | PASS | Actual Chromium UI; intercepted transport and SQLite objects |
| workerd-direct | PASS | Actual workerd: WebSockets, SQLite, KDF, receipts/chunks and idle reconstruction |
| workerd-integration | FAIL / BLOCKED | Separate Wrangler HTTP listener; EACCES localhost/inspector |
| wrangler-dry-run | PASS | Actual Wrangler 4.168.0 packaging/binding dry-run |
| backend-full | FAIL / BLOCKED (28/65) | Full legacy Socket.IO suite; network failures remain |

The focused suites total **208 passing tests**. The separate full legacy suite has 65 tests: 28 pass and 37 fail. Its passes overlap the focused suites and are not added to that total. The direct workerd runner has two test handlers and is reported separately.

Chromium exercises create/join, host access controls, approval/automatic admission, private invitation/password entry and URL cleanup, queue deltas/gap recovery, chat, local-file fingerprint/readiness/play/pause/seek, reconstructed snapshots, responsive layouts, reduced-motion posters and desktop/mobile video decoding/looping.

Real workerd exercises native WebSockets against SQLite Durable Objects, role authorization, chat/queue, locking/moderation, negotiated receipt/chunk delivery and strong password derivation. Its test observes a new object construction after actual idle eviction and verifies retained Host authority/access/state over the hibernating socket. It uses native service bindings rather than an HTTP listener; it does not validate production deployment or external services.

Failure tests cover SQL rollback/quarantine, old-schema migration, unknown/corrupt schemas, session revocation, proof rotation/lost ACK, slow auth/media/invite isolation, bounded retries, presence version races, denied joins and secret omission. Workload/presence simulations reach 500 participants/accounts. The eight-hour accelerated lifecycle and 60-second real-time in-process run are explicitly distinct from a long network/media soak.

Remaining observed failures: the separate Wrangler listener cannot connect to localhost (EACCES); 37 legacy wire tests fail before normal client/server exchange. Root clean npm ci failed with filesystem EPERM. npm audit failed with registry ENOTFOUND. Existing cached Wrangler dependencies enabled the real dry-run/direct-runtime tests; this does not establish a clean online installation or completed security audit.

External acceptance still requires real Supabase/OAuth/email/session revocation, actual Drive files/seeking/cookies/fallback, LiveKit room caps/webhooks/removal/calls, TURN/NAT/system audio/mobile devices and multi-version PWA upgrades. No live-service credentials or account plan were verified; no production deployment occurred.

Recorded verification: 2026-11-26T06:25:44.297Z. Last selection: ['workerd-direct']. Targeted reruns retain other recorded gates; overall verification remains failed while the blocked gates are open.

Source packaging checks exclude secrets/dependencies/builds/logs/screenshots/user images and validate extraction plus hashes. The ZIP is an inspectable source deliverable, not a production release sign-off.
