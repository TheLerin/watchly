# Watchly

**V2.1 hardening is unreleased and configuration-ready. Production acceptance is incomplete.** See [current remediation](REMEDIATION_REPORT.md), [readiness](PRODUCTION_READINESS.md), [tests](TEST_REPORT.md), [performance](PERFORMANCE_REPORT.md), [architecture](ARCHITECTURE.md) and [rollback](ROLLBACK.md).

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

Tests: `npm test`, `npm --prefix frontend test`, `npm --prefix frontend run lint`, `npm --prefix backend test`, `npm run test:integration`, `npm run test:browser`, `npm run test:browser:harness`. Use `npm run test:runtime` for direct workerd WebSocket/SQLite/KDF/actual idle reconstruction without a TCP listener. The separate `test:integration` needs reachable localhost. Browser/Node simulations do not verify external providers. `test:soak` and `test:presence` record the bounded lifecycle/presence workloads.

Production is not deployed by this repository's default CI. No paid resources are enabled. Staging can be explicitly dispatched through a GitHub environment after verification. See the deployment checklist before retiring any old service.
