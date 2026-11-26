# Production readiness — 26 November 2026

**Implementation and local runtime verification completed for the changes described in the issue register; external release acceptance remains blocked. No production deployment occurred.**

Passing evidence includes the focused suites, Chromium UI flows, lint/build/assets, Wrangler deployment dry-run, and direct workerd native WebSocket/SQLite/access/moderation tests. Workerd actually evicts and reconstructs an idle room; the strong password KDF runs in that runtime. See TEST_REPORT.md and docs/verification.json for exact counts and failed gates.

Remaining release gates:

1. Run clean npm ci in root/backend/frontend and dependency audits with registry access; the fresh-install attempt here failed EPERM and audit failed ENOTFOUND.
2. Pass the separate Wrangler HTTP integration and full legacy Socket.IO wire suite on a host allowing localhost connections. They remain failed here, even though direct workerd passes.
3. Apply `202611260001_watchly_session_check.sql` additively to the intended Supabase staging project and verify real OAuth/email/session revocation, profiles, friendship/block permissions and notifications. Do not reset data or rerun old create-table migrations.
4. Configure existing service credentials and verify real Drive Range/seek/fallback, LiveKit CreateRoom/maxParticipants, signed webhooks and server removal. Verify provider usage/spending limits against the actual free accounts.
5. Complete two-device/mobile/capture/audio/NAT/TURN and active-tab PWA upgrades. Run long real-network/media sessions and workload tests; the accelerated eight-hour lifecycle simulation is not a substitute.
6. Review application counters, capacity estimates and the documented public-guest/revocation/receipt/provider boundaries. Keep old hosts available, drain rooms, follow ROLLBACK.md and obtain explicit production authorization.

Use a workers.dev staging address; no purchased domain is required. The CI keeps production deployment manual. No account, billing option, DNS record, provider project or old deployment was changed.
