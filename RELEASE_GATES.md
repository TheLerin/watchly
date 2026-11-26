# Watchly V2.1 release gates

**Hold for release.** Dependency remediation is partial and staging/provider acceptance remains open. The follow-up changed local source and configuration templates. No provider settings, live databases, billing, or deployments were changed.

The status of all 17 issues is in PROJECT_ISSUES.md. The current source passed 66 Worker tests, 31 focused backend tests after a clean offline installation, and the staging binding check. The unchanged frontend passed 136 tests, lint, the production build and asset validation. The full legacy suite passed 67 tests before the latest lock changes. The broader run after those changes was interrupted before it could record a fresh full-backend result. Runtime, browser and restore evidence is in TEST_REPORT.md.

1. Finish the remaining compatible dependency upgrades and obtain current online audit results for root, backend and frontend. Cached patches passed offline installs and tests, while the current online audit remains blocked.
2. The owner provided `https://watchly-staging.wchly.workers.dev` and approved the additive migration only for isolated staging. This workspace could not reach that origin. Confirm the separate Supabase project reference and access before applying the approved migration. Verify Turnstile, LiveKit, OAuth and session revocation on staging.
3. Complete Drive/LiveKit/TURN acceptance and usage checks, two-device media/capture, long real network/media soak, and the staging rollback/drain exercise. Use docs/STAGING_ACCEPTANCE.md to record evidence.
4. Review the results and obtain production approval before changing live infrastructure.

Automatic approval review stopped broader verification and the longer runtime soak because telemetry targeted `dc.services.visualstudio.com` with an unknown payload. Completed local stages and their timestamps are in docs/verification.json. The 12-second internal WebSocket pilot is separate from the live network and media soak.
