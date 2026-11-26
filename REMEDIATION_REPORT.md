# Watchly V2.1 remediation report

26 November 2026. This continues the existing uncommitted migration. Existing UI/features, optimized background loops, Supabase records, LiveKit and rollback hosts remain. No production migration, deployment, DNS/billing change, commit, push or service retirement occurred. Unrelated user images were preserved.

| Severity | Finding | Implemented change | Evidence / status |
|---|---|---|---|
| Critical | Unsafe payload/ACK/exception handling | Shared safeEvents boundary, type/byte/rate limits and exception containment | Focused boundary tests pass; full legacy wire gate remains blocked |
| Critical | Public legacy Drive proxy | Active membership/selected-file grants, cookie renewal and signed fixed-origin bridge | Authorization, tamper, Range/HEAD/416/redirect tests pass; real Google acceptance pending |
| High | Resolver leaks/SSRF and unbounded upstream work | HTTPS allowlist on every hop, finite caches/resolvers, deadlines, cancellation and stream cleanup | Fixtures pass; live confirm-form/codec/seek behavior pending |
| High | Room-name allocation abuse | 64 fixed actor shards before allocation; bounded legacy ingress | Guard expiry/identity/denial tests pass |
| High | Uncontrolled new-work usage | Durable UTC-day room/social/call-admission counters and manual switches | Counter exhaustion/reset tests pass; provider billing remains external |
| High | Single-row state, full scans and sensitive persistence | Schema-3 records, dirty-table plans and compact secret-free connection/ACK records | Migration, zero-write and 500-participant simulations pass |
| Critical | Storage failure could expose uncommitted memory | Atomic SQL, no delivery before commit, quarantine/abort/reconstruct on failure | Injected write failure restores prior queue and delivers no success |
| High | Unsafe rollback could remove private admission | Schema marker raised to 3 with additive schema-2 upgrade | Upgrade preserves records; old schema-2 Worker fails closed |
| High | Incomplete admission/ban controls | Host private/password/account-only/lock/approval controls, bounded hashed invite tokens, expiry/revoke and moderator-aware unban UI | Worker and actual Chromium approval/private/password flows pass |
| High | Weak password handling | Salted PBKDF2-SHA256 at 600000 iterations outside room serialization | Correct/incorrect password tests pass in Node and actual workerd |
| High | Session revocation and long-lived membership proofs | Additive own-session RPC, production checks, permission/media revocation, five-minute account refresh, proof rotation with bounded lost-ACK grace | PostgreSQL ownership/expiry/anonymous-denial and room revocation/rotation tests pass; apply/verify on real project |
| High | External work stalled active room actions | Auth/KDF/social invite/provider room setup/presence/removal run outside serialized mutations and recheck authorization | Slow-auth/media/invite isolation tests pass; external RPC side effects remain distributed (see limitations) |
| High | Presence loss/races/stuck retries | Durable versioned outbox, source fencing, ten-minute leases, targeted notifications and bounded retries/terminal retention | Eviction/failure/version-race tests and 500-account directory simulation pass |
| High | Unbounded outgoing work | Negotiated delivery receipts, bounded window/queues, snapshot chunking and timeout recovery, bufferedAmount checks | Slow-reader/chunk/receipt tests pass; platform buffers and dishonest receipt peers retain limits |
| Medium | Duplicated playback math | Shared canonical time/reducer/rate/drift core with native/embed adapters, bounded source resolvers, coalesced cancellable clock sampling | Core/adapter/clock tests and Chromium local playback/recovery pass; live embeds/codecs require providers |
| Medium | Whole queue broadcast | Negotiated deltas and stable IDs/revisions with authoritative gap recovery | Protocol/reducer/Chromium subscriber tests pass |
| Medium | Late screen viewer and peer leaks | Authorized late-viewer notifications, replacement cleanup, bounded ICE and expiry cleanup | Signaling tests pass; real capture/audio/NAT/mobile acceptance pending |
| High | Media participant/cost exposure | Production CreateRoom verifies max six participants; token roomConfig, limited sources, encoding defaults and new-call budgets | Official-SDK grant verification and cap fixtures pass; real provider/admin/billing acceptance pending |
| High | Failed removal/replayed webhook | Durable watchdog, jitter, twelve retries, terminal retention and signed idempotent receipts | Failure/eviction/terminal/signature tests pass; real provider delivery pending |
| Medium | Unbounded or sensitive diagnostics | In-memory 256-event aggregates with wall-time/logical-row labels, no identities or persisted telemetry | Source boundary; not a production CPU/billing measurement |
| Medium | Active-tab update and stale assets | Waiting PWA, non-interrupting update notice, cache boundaries and compatible headers | Build/notice logic/Chromium existing assets pass; actual cross-version SW acceptance pending |
| High | Missing toolchain/runtime proof | Wrangler 4.168.0 pinned with npm-generated lock validated offline; native workerd test runner bypasses need for HTTP listener | Dry-run and real WebSocket/SQLite/KDF/idle reconstruction pass; HTTP listener remains EACCES |
| High | Full external release verification | Fail-visible verifier, CI, workload/soak evidence and explicit release gates | Focused checks pass; legacy wire/HTTP/audit/clean-install/live-device gates remain blocked |

Detailed evidence is in TEST_REPORT.md, PERFORMANCE_REPORT.md and docs/*.json. Configuration/operation is in CLOUDFLARE_DEPLOYMENT.md and ROLLBACK.md. The source distribution excludes secrets, dependencies, generated builds, logs/screenshots and unrelated user files. No claim of unlimited free capacity or completed production acceptance is made.
