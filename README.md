# Watchly

**V2.1 remains unreleased.** The current targeted changes and unresolved gates are recorded in [release gates](RELEASE_GATES.md), [tests](TEST_REPORT.md) and [dependency remediation](DEPENDENCY_REMEDIATION.md). Earlier hardening details remain in [current remediation](REMEDIATION_REPORT.md), [architecture](ARCHITECTURE.md) and [rollback](ROLLBACK.md).

Watchly's existing React UI, Supabase accounts/social data and LiveKit calls now have an additional Cloudflare deployment path: Workers Static Assets + API routing + one SQLite Durable Object per room, using native WebSockets. Existing Vercel/Render deployments remain available for rollback.

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm ci
npm run build
npm run dev
```

Copy `.env.example` to `frontend/.env.local` for public configuration, and `.dev.vars.example` to `.dev.vars` for private local Worker secrets. Existing Supabase/LiveKit credentials stay with their services. Cloudflare builds force same-origin native transport; original frontend builds can still select the explicit Socket.IO backend for rollback.

- [Deployment, secrets, staging and rollback](CLOUDFLARE_DEPLOYMENT.md)
- [Architecture audit and full event mapping](CLOUDFLARE_AUDIT.md)
- [Feature parity and verification boundaries](FEATURE_PARITY.md)
- [Security review and moderation limitations](SECURITY_REVIEW.md)
- [Free-tier estimates and media costs](COST_ANALYSIS.md)
- [Migration report and file inventory](MIGRATION_REPORT.md)

Combined verification: `npm run verify` (fails visibly while required checks are blocked). Local simulation: `npm run test:benchmark`.

Anonymous creation now requests Turnstile verification after repeated attempts (or immediately for available trusted risk signals). Configure per-environment keys before acceptance. LiveKit uses separate staging/production/legacy room prefixes. See [configuration and cutover](docs/TURNSTILE_AND_MEDIA_ISOLATION.md) and the [additive Supabase session-check migration](docs/SUPABASE_SESSION_MIGRATION.md).

The [staging acceptance procedures](docs/STAGING_ACCEPTANCE.md) cover service configuration, real browser and media checks and recovery. The [issue register](PROJECT_ISSUES.md) records the latest status of the 17 requested fixes.

Tests: `npm test`, `npm --prefix frontend test`, `npm --prefix frontend run lint`, `npm --prefix backend test`, `npm run test:integration`, `npm run test:browser`, `npm run test:browser:harness`. Use `npm run test:runtime` for direct workerd WebSocket/SQLite/KDF/actual idle reconstruction without a TCP listener. The separate `test:integration` needs reachable localhost. Browser/Node simulations do not verify external providers. `test:soak` and `test:presence` record the bounded lifecycle/presence workloads.

Production is not deployed by this repository's default CI. No paid resources are enabled. Staging can be explicitly dispatched through a GitHub environment after verification. See the deployment checklist before retiring any old service.
