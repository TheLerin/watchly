# V2.1 remediation checklist

- [x] Safe shared payload/ACK/exception and ingress boundaries.
- [x] Selected-file Drive authorization, signed fixed-origin fallback and bounded streaming failure paths.
- [x] Fixed-shard abuse controls and automatic daily application admission counters.
- [x] Schema-3 granular/dirty-table persistence, transactional migration, rollback fences and storage-failure quarantine.
- [x] Private/password/account-only/locked/approval-controlled entry, expiring/revocable invitations and unbanning, with host UI.
- [x] Strong salted password KDF outside room serialization; no raw invitation/password/resume/account secrets in durable ACKs or public snapshots.
- [x] Production session-status RPC, action revocation, account lease refresh and reconnect proof rotation.
- [x] Auth/social/KDF/provider/presence/media work isolated from the room queue with post-work authorization checks.
- [x] Durable versioned presence outbox, leases, targeted notifications, terminal retries and failure tests.
- [x] Shared canonical playback/time/drift core, capability adapters, source/clock/recovery module boundaries.
- [x] Negotiated queue deltas, revision recovery and bounded server/browser delivery including chunked snapshots.
- [x] Provider room participant cap, scoped grants, media-removal watchdog/retries and webhook deduplication.
- [x] Sampled aggregate diagnostics without persistent telemetry or identifiers.
- [x] Safe PWA activation, update notice, headers and hashed-asset cache rules.
- [x] Pinned Wrangler/root lockfile, CI ordering and fail-visible verification.
- [x] Focused tests, Chromium access/playback/recovery checks, real workerd idle reconstruction/KDF, deployment dry-run.
- [x] Room/load and presence simulations through 500 participants/accounts; eight-hour accelerated lifecycle and 60-second in-process soak.
- [x] Updated implementation, test, security, cost, performance and rollback documentation and source archive.
- [ ] Clean online install and dependency audit: EPERM/registry DNS blockers here.
- [ ] Separate Wrangler HTTP integration and full legacy wire suite: localhost EACCES here.
- [ ] Live services, provider account limits, real devices, active-tab PWA upgrade and long network/media soak: project/device access required.
- [ ] Production cutover: explicit authorization and passing external acceptance required.

Checked items identify implementation plus the stated local evidence, not external production sign-off. See REMEDIATION_REPORT.md and KNOWN_LIMITATIONS.md.
