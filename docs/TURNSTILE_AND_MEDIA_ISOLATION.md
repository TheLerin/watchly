# Anonymous creation and media environment isolation

## Turnstile configuration

Production Workers challenge anonymous creation after two attempts per trusted source address in ten minutes by default. `ANON_CREATE_CHALLENGE_AFTER` accepts 0–5, where 0 challenges every anonymous attempt. Production Render challenges every anonymous creation because its local rate counters reset on restart. `TURNSTILE_ENFORCE_ANONYMOUS=true` also enables the test policy locally. Authenticated, unexpired profiles bypass the challenge while action limits still apply. On Workers, an available Cloudflare bot score below 30 requires an immediate challenge.

Configure a Turnstile widget for the actual frontend host in each environment. Put its public `TURNSTILE_SITE_KEY` in that environment's Wrangler vars (or Render environment), and its private `TURNSTILE_SECRET_KEY` in Worker secrets or Render secrets. The checked-in public keys are deliberately empty. No widget, secret or provider setting was created during this work. The widget action must be `room_create`. For a cross-origin legacy frontend, the widget hostname is the allowed frontend hostname, not the Render API hostname.

The browser loads the widget only after the server requests verification. Cancellation creates no room. The server verifies against Siteverify and requires success, the expected hostname, `room_create`, and a challenge timestamp within five minutes. Missing configuration, invalid proof and upstream failures fail closed for challenged attempts. Tokens are not retained in browser storage or logged. A bounded hash ledger additionally prevents concurrent replay because Siteverify's replay detection is eventually consistent. Worker risk counts and redemptions survive object eviction; legacy Render uses bounded process-local ledgers and loses those counters on restart. Trusted source-address configuration is therefore essential on Render; see `TRUST_PROXY_HOPS` in the deployment guide.

After approval to configure staging, set its public key, then use `wrangler secret put TURNSTILE_SECRET_KEY --env staging`. Verify normal creation, third-attempt challenge, cancellation, token expiry/replay, wrong hostname/action and an outage. Use real staging widgets/accounts for provider acceptance; test fixtures are not evidence that the real widget is configured. Repeat configuration for production only after explicit approval.

Official verification contract: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## LiveKit namespaces

| Deployment | `LIVEKIT_ROOM_NAMESPACE` | Room name |
|---|---|---|
| Local Worker | `development` | `watchly-development-voice-<code>` |
| Staging Worker | `staging` | `watchly-staging-voice-<code>` |
| Production Worker | `production` | `watchly-production-voice-<code>` |
| Legacy Render | `legacy-render` | `watchly-legacy-render-voice-<code>` |

Participant identities retain `watchly-<memberId>`. Token grants, CreateRoom and server removal all use the deployment's exact room prefix. Production Workers require an explicit staging/production namespace; the legacy server rejects any namespace other than `legacy-render`. Keep the namespace stable for the lifetime of a deployment's rooms.

Each deployment receives signed events at its own `/api/livekit/webhook` URL. Signature/body checks precede processing. A webhook for another prefix or the old unscoped `watchly-voice-<code>` name is acknowledged and ignored. Workers reject it before allocating a room object and repeat the scope check internally. Persisted removal jobs carry a namespace; old or foreign jobs terminate with `MEDIA_JOB_NAMESPACE_MISMATCH` without a provider removal call. Render also verifies signatures and filters scope before any removal. Render's webhook receipts/removal remain process-local; Worker jobs/receipts are durable.

Drain existing unscoped calls before changing the old deployment. The new source deliberately cannot sweep old unscoped rooms because their environment ownership is ambiguous. If old calls need manual moderation, first establish ownership in the provider console. Never bulk-remove participants by room code alone. Separate LiveKit projects/credentials offer additional separation where available; these prefixes isolate names even when an existing project is shared.

Before release, deliver a signed staging event to each webhook endpoint and confirm only staging processes it. Repeat with production and legacy prefixes, then test an active staging kick and observe the actual provider participant state. None of those live-provider actions were performed here.
