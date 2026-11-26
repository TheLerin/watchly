# Production readiness - 26 November 2026

**HOLD: unresolved critical/high dependencies and live acceptance prevent release approval.** Current details are in RELEASE_GATES.md, PROJECT_ISSUES.md, DEPENDENCY_REMEDIATION.md and TEST_REPORT.md.

The targeted source implements mandatory server-side Turnstile for repeated/suspicious anonymous creation, scoped LiveKit names/webhooks/removal, corrected secure resume-token integration assertions, explicit binding checks and Supabase session-migration instructions. Existing UI/features remain; the verification dialog appears only when requested by the server.

Local evidence includes 62 Worker, 136 frontend and 67 full backend tests, lint/build/assets/bundling, Chromium flows, real workerd idle reconstruction/KDF/anonymous challenge and Wrangler HTTP integration. The 29 backend-focused passes overlap the full suite. Older reports of 37 failed legacy wire tests and blocked local HTTP integration are superseded by completed passing runs.

Recorded audits: root 0, backend 1 critical/6 high, frontend 21 high. Cached compatible upgrades are installed and tested. Remaining upgrades and a current online audit are incomplete. Automatic approval review blocked execution for unapproved telemetry with an unknown payload. This is not a clean dependency gate.

Before release, close that gate, configure real environment-specific Turnstile/LiveKit settings, verify remote bindings/secrets, obtain approval for the additive Supabase staging migration, and complete auth/Drive/media/mobile/TURN/PWA/long-session acceptance. Keep compatible rollback/old hosting available. No production deployment, live migration, paid activation, account change or DNS change was performed. Production requires explicit approval after the open gates pass.
