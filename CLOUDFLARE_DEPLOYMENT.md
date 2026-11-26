# Deploy Watchly to Cloudflare

The source is prepared; production deployment is **not yet verified**. Dependency security, external OAuth/Drive/LiveKit/Turnstile/TURN and two-device media/moderation acceptance remain release gates. Local workerd and HTTP integration pass. No account, billing setting, deployment, DNS record or existing service was changed during this work.

## 1. Account and dependencies

Use a Cloudflare account on Workers Free. SQLite Durable Objects require no D1 database, R2 bucket or paid Workers plan. A purchased domain is unnecessary.

From the repository root, with Node 24:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm ci
npx wrangler login
```

Wrangler is pinned to 4.168.0 in the root lockfile. See RELEASE_GATES.md for current installation, audit and runtime results; a dry-run does not validate remote secrets or deployed resources.

## 2. Public browser configuration

```powershell
Copy-Item .env.example frontend/.env.local
Copy-Item .dev.vars.example .dev.vars
```

Populate `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with the existing project values. Leave `VITE_BACKEND_URL` blank for same-origin Workers. `npm run build` forces the native transport and blank backend origin even if a legacy `.env` exists. Retain `VITE_VOICE_PROVIDER=livekit` and `VITE_MEDIA_PROVIDER=livekit`. No media provider is enabled or provisioned automatically.

Set `VITE_SITE_ORIGIN` to the actual staging/production HTTPS origin once known, and rebuild for absolute homepage canonical/social/sitemap URLs. If it is blank, the Cloudflare build uses relative homepage metadata and an empty sitemap rather than pointing at the old Vercel origin. Room previews always use the request's current origin.

For the existing Node/Vercel rollback build, use the original `npm --prefix frontend run build`, an explicit Render `VITE_BACKEND_URL`, and `VITE_REALTIME_TRANSPORT=socketio`.

## 3. Secrets and resources

| Variable | Source and purpose | Required |
|---|---|---|
| `SUPABASE_URL` | Existing Supabase project API URL | Accounts |
| `SUPABASE_PUBLISHABLE_KEY` | Existing project's public/publishable API key | Accounts |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing backend secret; restricted invitation RPC only | Friend invites |
| `LIVEKIT_URL` | Existing project's `wss://` URL | Existing voice/video |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Existing LiveKit project API credentials | Token issuance and server moderation |
| `MEDIA_SESSION_SECRET` | Independent random 32+ byte secret | Google Drive media cookies |
| `TURN_URLS`, `TURN_SHARED_SECRET` | Existing coturn URLs and REST shared secret | P2P relay on restricted networks |
| `TURN_TTL_SECONDS` | Optional, defaults to 3600, bounded 300–86400 | Optional |
| `GDRIVE_LEGACY_SECRET` | Independent shared Worker/Render HMAC secret for short signed fallback requests | Required with fallback |
| `GDRIVE_LEGACY_ORIGIN` | Fixed HTTPS origin of current Render proxy, no path/query | Only if direct Drive delivery fails |
| `TURNSTILE_SITE_KEY` | Public widget key in environment vars; checked-in value is empty | Anonymous challenge |
| `TURNSTILE_SECRET_KEY` | Private widget key in Worker/Render secrets | Mandatory server verification |
| `LIVEKIT_ROOM_NAMESPACE` | Explicit `staging` / `production` Worker var; `legacy-render` on Render | Media isolation |

Generate the media-cookie secret locally, then paste it at Wrangler's secret prompt. Do not put secrets on command lines, in `VITE_*`, in Git or in workflow YAML.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npx wrangler secret put SUPABASE_URL --env staging
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put LIVEKIT_URL --env staging
npx wrangler secret put LIVEKIT_API_KEY --env staging
npx wrangler secret put LIVEKIT_API_SECRET --env staging
npx wrangler secret put MEDIA_SESSION_SECRET --env staging
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
```

Set optional TURN/legacy secrets using the same `secret put NAME --env staging` form only if those services are used. Repeat for `--env production` when production cutover is approved. Use separate staging LiveKit rooms/projects and a Supabase test project where practical; production retains the original Supabase project and records. Never run credential-dependent test fixtures against production data.

Wrangler provisions all three SQLite classes (rooms, presence and fixed-shard abuse budgets) through `migrations.new_sqlite_classes`. Bindings are repeated for staging/production and receive distinct namespaces under `watchly-staging` and `watchly-production`. Do not copy Durable Object namespace IDs or apply a D1 migration. Retain the two existing Supabase migrations; apply only the new additive `202611260001_watchly_session_check.sql` to staging, then verify own-session revocation. Production account checks fail closed if that RPC is missing. Never reset the database or rerun the original create-table migrations.

## 4. Auth redirect configuration

After obtaining the actual staging `workers.dev` URL, add that origin and its existing `/auth/callback` path to Supabase Auth URL configuration. Inspect `AuthContext.jsx` for the provider's actual callback before saving. Allow local Vite/Worker origins only in development settings. For Google sign-in, the OAuth provider's redirect remains the existing Supabase callback; the application return URL changes to the deployment origin. Keep old production redirect URLs until rollback is no longer needed.

## 5. Run and verify locally

```powershell
npm run build
npm run dev
```

Open Wrangler's printed local URL. For HMR, run `npm --prefix frontend run dev` in a second terminal; Vite proxies `/api` and `/ws` to port 8787. The local frontend must select native transport and have a blank backend URL. `.dev.vars` is private and never deployed as an asset.

Tests (run from the root, in separate commands so failures are visible):

```powershell
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm test
npm run build
npm run check:deploy
npm run test:runtime
npm run test:integration
npm run test:browser
npm run test:browser:harness
```

The integration/browser scripts launch an isolated local Wrangler configuration without loading real secrets. The browser harness uses actual Chromium with test-only network interception and SQLite objects; it is explicitly **not** a workerd/external-media test. Install Chromium with `npm --prefix frontend exec -- playwright install chromium` or set `BROWSER_EXECUTABLE` to an installed Chrome/Edge executable. Tests must never target production.

For a bounded local load check, keep a local Wrangler instance running:

```powershell
$env:WATCHLY_TEST_BASE = 'http://127.0.0.1:8787'
$env:ROOMS = '5'
$env:PARTICIPANTS = '3'
npm run test:load
```

The load script rejects non-local destinations and caps room/participant counts. Its output is a local sample, not a production capacity result.

## 6. Deploy staging

After all local runtime checks pass:

```powershell
npm run build
npm run deploy:staging
```

Wrangler prints the real free `workers.dev` URL; no resource IDs or account IDs are invented in this repository. Verify health, SPA reload, Google/email login/logout and refresh, guest/account recovery, private social data, room isolation, roles/kicks, queues, YouTube playlists, local-file selection/readiness/play/pause/seeking/reconnect, Drive Range seeking, chat, voice, camera, mobile layout and screen share on two real devices/networks.

Configure the **existing LiveKit project** to send signed webhooks to `https://<staging-host>/api/livekit/webhook`. Confirm `participant_joined` events reach the endpoint. Kick an active camera/mic participant and verify their participant is absent from LiveKit server state, not merely hidden in Watchly. Retry their old token and a new token request. Verify upstream API failure retries persist across room eviction. Cloud-hosted token revocation differs from self-hosted LiveKit: see `SECURITY_REVIEW.md`.

Screen Share Beta remains P2P with three viewers and its existing bitrate bound. Moving it into LiveKit would change publish grants, shared-session track ownership, quota consumption and UI behavior. That change is deliberately deferred until real media regressions and account costs can be tested; no reliability or price benefit is assumed.

## 7. Production cutover and rollback

Do not run the following until production deployment is approved and staging release gates pass:

```powershell
npm run build
npm run deploy:production
```

Keep existing Vercel/Render hosting running throughout. Existing active Socket.IO rooms remain on Render and cannot be hot-migrated into Durable Objects. Schedule a drain window: let existing rooms end, announce a reload/rejoin, then direct new sessions to the Workers origin. Do not make two backends jointly own a room. Old and new builds each select exactly one transport; same-looking codes on different origins are separate rooms. Guest resume credentials are backend-specific; Supabase accounts remain the same.

For a Worker regression:

```powershell
npx wrangler deployments list --env production
npx wrangler rollback --env production
```

Rollback code does not undo Durable Object schema migrations or Supabase data. Keep future schema changes backward-compatible. For full hosting rollback, restore the previous frontend URL/configuration (or previously recorded DNS target if an approved domain cutover happened), retain Render, and have users create/rejoin legacy rooms. Do not copy Worker resume tokens into legacy rooms or promise cross-backend room continuity.

## 8. Optional custom domain, CI and monitoring

Workers Dashboard → chosen Worker → Settings → Domains & Routes can attach an owned domain after explicit approval. Record old DNS values and add the new application origin to Supabase redirect settings. Neither a domain nor DNS edits are required for `workers.dev`.

`.github/workflows/cloudflare.yml` validates the Worker and adds an explicitly dispatched, GitHub-environment-gated staging deployment. Configure `CLOUDFLARE_API_TOKEN` (Worker edit permission) and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets only if you enable that workflow. No automatic production deployment is configured.

Review Worker errors/CPU, DO requests and active duration, SQLite read/write rows/storage, Supabase egress/realtime connections and LiveKit/TURN usage separately. Use sampled logs; do not log frame bodies, JWTs, cookie contents or private URLs. `wrangler tail --env staging` can inspect errors during staging verification. Free plans fail operations when allowances run out; they do not guarantee unlimited free uptime. No paid upgrade, SFU app or R2 resource is enabled here.


## V2.1 hardening operational notes

Root Wrangler is pinned to 4.168.0 and all three lockfiles are checked in. CI uses `npm ci` and fails on critical/high audit findings. See DEPENDENCY_REMEDIATION.md for the current incomplete dependency gate.

Run `npm run check:bindings`, `npm run check:deploy:staging` and `npm run check:deploy:production` before an approved deployment. These validate the explicit ASSETS, ROOMS, PRESENCE and ABUSE bindings and SQLite migration declarations without deploying. They do not verify account secrets, actual remote namespaces or provider configuration. The [session migration guide](docs/SUPABASE_SESSION_MIGRATION.md) covers the additive RPC and staging acceptance without resetting data.

Configure separate Turnstile widgets/keys and retain the exact LiveKit namespace for each environment. Read [anonymous creation and media cutover](docs/TURNSTILE_AND_MEDIA_ISOLATION.md) before updating any deployment. Both Workers and Render now expose `/api/livekit/webhook`; foreign and unscoped room names are ignored, and old calls need an ownership-aware drain.

Both Worker and Render need their configured `MEDIA_SESSION_SECRET` for their own cookie grants. The optional bridge additionally requires the same independent `GDRIVE_LEGACY_SECRET` on both sides. Deploying only the Worker bridge change against an old public Render proxy is not the supported final configuration; deploy and verify its authentication middleware together. Never expose these secrets through `VITE_*`.

`TRUST_PROXY_HOPS=0` on Render trusts the TCP peer. Set it to 1 only after confirming exactly one trusted proxy appends the real source address. Broadly trusting client forwarding headers weakens rate limits. Shared-IP limits can affect campus/NAT bursts; test legitimate usage before cutover.

Manual controls `ALLOW_NEW_ROOMS`, `ENABLE_SOCIAL_PRESENCE`, `ENABLE_DRIVE_PROXY` and `ENABLE_CALLS` default to enabled unless explicitly `false`. They are operational switches, not automatic quota accounting. They do not change provider account limits or disconnect already active calls.

Storage schema 3 migrates the former single row transactionally. Older schema-1 Worker code cannot read migrated rooms. Use the schema-compatible/drain procedure in `ROLLBACK.md`; do not promise an old-version rollback preserves active rooms. The service worker now waits for old tabs to close before activation; multi-version active-room testing remains a release gate.

Daily application defaults in wrangler.jsonc are 1000 new-room admissions, 10000 social lookups and 100 new call tokens per UTC day. Adjust only against verified account limits. These are not provider billing counters. Production LiveKit room creation verifies maxParticipants <= 6; an existing unlimited room must empty. ENABLE_DIAGNOSTICS=true enables bounded identity-free event aggregates.
