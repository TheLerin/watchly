# Changelog

## V2.1 branding update - 27 November 2026, unreleased

- Replaced the Watchly mark across the landing page, account pages, rooms, favicon and install icons.
- Added cycling blue, cyan, turquoise, mint, lavender and gold fills to primary actions and used the palette in the startup and mid-playback buffering ring.
- Kept a static gradient when the device requests reduced motion.

## V2.1 targeted follow-up - 26 November 2026, unreleased

- Corrected resume integration assertions for token rotation, superseded sockets and bounded disconnected recovery grace; added persisted expiry coverage.
- Added server-verified Turnstile for repeated/suspicious anonymous creation, bounded replay protection and the conditional verification dialog.
- Isolated LiveKit names, signed webhook dispatch and removal jobs across staging, production and legacy Render; ambiguous old jobs cannot remove participants.
- Added staging/production binding checks and dry-run gates, plus session-migration instructions.
- Pinned patched ws 8.21.0 in both application graphs. Other critical/high dependency remediation remains blocked; see DEPENDENCY_REMEDIATION.md and RELEASE_GATES.md for the current evidence and limitations.

## V2.1 hardening work — 26 November 2026, unreleased

- Added shared safe event/acknowledgement validation and bounded legacy ingress limiting.
- Authorized legacy Drive access and signed the Worker fallback; bounded and secured redirect/resolution/stream failure paths.
- Added 64 fixed abuse-budget shards and manual admission/media/social controls.
- Replaced single-row room persistence with schema-3 per-record SQLite storage, atomic migration and sensitive-data omission.
- Stopped snapshot/rejected/ephemeral-event writes and extracted incremental queue convergence.
- Moved auth/presence/media administrative I/O outside critical room mutations; bounded media jobs and webhook replay receipts.
- Added late screen-viewer signaling, peer cleanup and bounded ICE queues.
- Made service-worker activation wait and restricted immutable caching to hashed bundles.
- Repaired CI ordering and preflight configuration; added reproducible verification, simulation results and current readiness/cost/rollback reports.

- Added full host access/invitation/approval/unban controls, strong password records and account-session revocation/proof rotation.
- Added durable versioned presence, dirty-table persistence, storage quarantine and schema-2-to-3 rollback fencing.
- Consolidated canonical playback/time/drift logic, provider capability adapters, source resolution and cancellable clock sampling.
- Added bounded delivery receipts/chunk recovery, provider participant caps, daily application counters and aggregate diagnostics.
- Added waiting-update notice and pinned Wrangler/root lockfile with direct workerd KDF/WebSocket/SQLite/actual idle-reconstruction verification.
- Added 500-account presence evidence, eight-hour accelerated lifecycle and a separate 60-second in-process soak.

Unreleased: separate HTTP/legacy wire, clean installation/audit and live-provider/device acceptance remain blocked. See TEST_REPORT.md.
