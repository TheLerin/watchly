# Cost and free-tier model — 26 November 2026

No billing was activated. Zero cost requires every existing account to remain inside its provider-enforced free allowances. The following are published allowances and explicit planning assumptions, **not a supported-user limit or a bill estimate based on production measurements**.

| Dimension | Published free allowance used |
|---|---:|
| Worker requests | 100,000/day |
| Worker HTTP CPU | 10 ms/request |
| DO requests | 100,000/day; incoming WebSocket messages weighted 20:1 |
| DO active duration | 13,000 GB-s/day |
| DO SQLite reads | 5 million rows/day, conservatively using the technical pricing page |
| DO SQLite writes | 100,000 rows/day, including deletes and alarm writes |
| DO storage | 5 GB/account |
| Individual static asset | 25 MiB |
| Supabase | 500 MB database, 50,000 MAU, 1 GB files, 5 GB egress and 5 GB cached egress |
| Supabase Realtime | 200 peak connections and 2 million messages/month |
| LiveKit Cloud Build, if that is the existing account plan | 5,000 participant-minutes and 50 GB downstream/month |

Cloudflare's marketing table currently shows 50M daily SQL reads while the technical pricing page shows 5M. This model uses 5M until the account's effective limit is confirmed. Existing LiveKit/coturn plan configuration was not accessed. Free LiveKit Build allowances are hard caps; paid plans have different exposure. Self-hosted TURN costs depend on its host and bandwidth agreement.

## Reproducible scenarios

`docs/capacity-estimates.csv` contains 225 cases: 10/50/100/250/500/1,000/2,000/5,000/10,000 DAU, 0.5/1/2/4/8-hour sessions, and five service mixes. `guest-local` has no account/media service use. `accounts-local` adds social traffic. `drive-only` proxies 120 Range requests per daily participant. `mixed-calls` assumes registered users, 20% Drive users and 10% of user-hours in a 1-Mbps downstream call. `screen-p2p` assumes 5% of users initiate group screen sessions, four people per group and 20% relay use.

A user is not a room, connection, participant-minute or MAU. Average room size is four. Peak population is the greater of 20% of DAU or twice daily user-hours divided by 24, capped at DAU. Registered monthly unique users are shown as a lower bound of recurring DAU and an upper bound of 30 disjoint daily cohorts. These bounds can straddle the MAU allowance.

Per-user incoming frames are assumed `30 + 230 * sessionHours`. Worker routing is assumed 12 requests plus Drive and call authorization. DO overhead is assumed 14 requests plus frames/20; Drive adds both a fresh room authorization and an abuse-guard request for each Range request. Rate guard requests are real added overhead. A planning write envelope uses twice `50 + 10*hours + 60*accountFraction + 240*driveFraction + 8*callFraction` rows/user/day. The factor of two is provisional headroom, not a measured index multiplier or a guaranteed bound. Reads use `400 + 50*hours + 300*accountFraction + 240*driveFraction`. Active duration is assumed 0.6 GB-s/user-hour. Retained room records assume 15 KB/user within the temporary room lifetime. All coefficients need replacement with staging telemetry.

| DAU, two hours/day | Guest Worker requests | Guest DO requests | Guest write envelope | Mixed-call minutes/month | Mixed-call GB/month |
|---:|---:|---:|---:|---:|---:|
| 10 | 120 | 385 | 1,400 | 3,600 | 27 |
| 50 | 600 | 1,925 | 7,000 | 18,000 | 135 |
| 100 | 1,200 | 3,850 | 14,000 | 36,000 | 270 |
| 250 | 3,000 | 9,625 | 35,000 | 90,000 | 675 |
| 500 | 6,000 | 19,250 | 70,000 | 180,000 | 1350 |
| 1,000 | 12,000 | 38,500 | 140,000 | 360,000 | 2700 |
| 2,000 | 24,000 | 77,000 | 280,000 | 720,000 | 5400 |
| 5,000 | 60,000 | 192,500 | 700,000 | 1,800,000 | 13500 |
| 10,000 | 120,000 | 385,000 | 1,400,000 | 3,600,000 | 27000 |

Even 50 DAU with the illustrative call fraction produces 18,000 participant-minutes/month, above the published Build allowance. A 5,000-DAU two-hour guest-only workload exceeds modeled DO request/write allowances. SQL writes can bind before Worker request count. Social concurrency, media minutes or relay bandwidth can be the earlier limit in other mixes. No maximum DAU is established.

At 2.5 Mbps, one screen viewer receives about 1.125 GB/hour; three viewers require about 7.5 Mbps of sharer upload before overhead. An SFU reduces repeated host upload but retains downstream usage. Local movies remain on devices and YouTube delivery stays between browser and provider. Drive proxying consumes extra Worker/DO/guard calls and upstream bandwidth; it is not an unlimited media-hosting service. The CSV does not estimate a provider permission to redistribute films.

## Enforcement and degradation

Per-room membership/frame limits, fixed-shard cross-room rate budgets, bounded collections and short media grants constrain abuse. `ALLOW_NEW_ROOMS=false` pauses new creation; `ENABLE_SOCIAL_PRESENCE=false`, `ENABLE_DRIVE_PROXY=false` and `ENABLE_CALLS=false` disable those new operations. Existing active playback remains available where provider quotas permit it. In addition, durable application counters automatically pause new room admissions/social lookups/call tokens at 1000/10000/100 per UTC day by default. They are configurable in wrangler.jsonc and count admission attempts, not billed CPU/rows/media minutes or bandwidth. Provider exhaustion can reject essential requests as well. Existing LiveKit sessions are not disconnected by `ENABLE_CALLS=false`.

Client media meters are estimates, can be bypassed, and are not billing controls. Application admission counts are durable but do not provide an exact billing meter. Production CreateRoom verifies a provider-side maximum of six participants per room; existing unlimited rooms must empty. Provider account usage/spending caps and media-duration/bandwidth limits are not verified. No Turnstile subscription, paid WAF or paid rate-limit product was provisioned. Distributed abuse can consume Free requests even when downstream room allocation is denied.

## Primary sources checked

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://www.cloudflare.com/products/durable-objects/
- https://supabase.com/pricing
- https://supabase.com/docs/guides/realtime/limits
- https://docs.livekit.io/deploy/admin/quotas-and-limits/

The latest timer changes coalesce clock sampling; authenticated native tabs re-supply credentials at five-minute intervals to renew directory leases. The scenario matrix is an estimate, not a fresh wire capture or account usage report. See PERFORMANCE_REPORT.md for current measurements.
