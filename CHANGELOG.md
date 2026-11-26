# Changelog

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
