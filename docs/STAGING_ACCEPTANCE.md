# Watchly staging acceptance

Use the confirmed staging Worker, a staging Supabase project and staging LiveKit credentials. Schedule the checks with the project owner so the provider costs, test accounts and affected rooms are known. Record the commit, device/browser, check outcome and request IDs. Keep session proofs and service secrets out of the results.

The owner supplied `https://watchly-staging.wchly.workers.dev` as the staging Worker. The corresponding Supabase redirect allowlist entry is `https://watchly-staging.wchly.workers.dev/auth/callback`. Confirm the isolated Supabase project reference from its dashboard before any writes. The owner approved `202611260001_watchly_session_check.sql` for isolated staging only. Live reachability and provider bindings were not verified from this workspace.

| Gate | Procedure and evidence |
|---|---|
| Turnstile | Configure the staging widget for the frontend hostname. Set its public key in staging vars and private key in Worker secrets. Try ordinary guest creation, the configured challenge threshold, cancellation, a valid challenge and Siteverify failures. A rejected challenge must leave no room. Verify the `room_create` action and hostname in the server's acceptance path. |
| Supabase sessions | Approve and apply `202611260001_watchly_session_check.sql` to staging. Follow SUPABASE_SESSION_MIGRATION.md to confirm current-session access, signout and rejection after the session check cache expires. |
| OAuth and email | Add the exact `https://<staging-host>/auth/callback` to Supabase Auth URL Configuration. Verify the Site URL for the intended project. Google OAuth's provider callback is the Supabase project callback. Verify fresh Google sign-in, cancellation, an email signup/sign-in, existing profile, and signout. Record the final origin and path without credentials. |
| LiveKit | Use the `staging` namespace and staging webhook URL. Confirm joins and video/audio across two clients. Dispatch only authorized, provider-signed test events. Confirm the staging endpoint ignores foreign namespaces and kicks remove the actual participant. Drain old unscoped calls with an owner-verified room list before cutover. |
| Drive | Use a test-owned video file. Confirm normal playback, Range seeking, rejected unauthorized access, private cookie settings, source changes, and stopped delivery after kick or revocation. Check unknown response size and 429 handling with a configured byte cap. |
| Devices and PWA | Test current desktop Chromium, one iOS Safari device, and one Android Chrome device on Wi-Fi and cellular/restrictive NAT where available. Verify camera/mic permission denial and retry, screen and system-audio capability, TURN relay, network changes and reconnection. Keep two active tabs across an approved staging version change, verify both continue working, close them and confirm the next session uses the updated version. |
| Soak and presence | Use an agreed interval and load. Sample playback drift, reconnect count and latency, runtime memory and provider usage. Sample high-friend-count presence refreshes and latency before increasing concurrency. `npm run test:soak:network` is a loopback WebSocket check, and `npm run test:presence` measures local SQLite operations. Live media capacity needs measurements from the actual services. |
| Resource controls | Compare actual LiveKit participant-minutes and egress, TURN traffic and Worker/DO CPU and database limits against the current account usage dashboards. Configure provider limits where available and set application budgets from those measurements. `DAILY_DRIVE_BYTE_BUDGET` optionally reserves the declared response size for each Worker body. Aborted transfers still count toward that conservative allowance. |

## Legacy Render fallback

Run the legacy backend as a single instance while it owns room membership in process memory. Production always challenges anonymous creation with Siteverify, including after restart. Process-local rate counters and webhook receipts reset with the process. Concurrent matching webhook work is coalesced and provider removal is scoped and idempotent. Drain rooms before restarts, route new sessions to Workers during the drain and avoid scaling Render without a shared authoritative room store and ledger. Render Blueprint auto-deploy is disabled in this source to keep the fallback cutover deliberate.

## Recovery drill

1. Record the active staging Worker version, its exact room schema, service configuration revision and environment-specific LiveKit namespace. Confirm the rollback build reads schema 3. Keep the previous build and its static assets available.
2. Create a private staging test room, add media/queue state and test viewers, then stop new admissions at the approved cutover boundary. Allow calls to finish and record a supported provider backup/recovery point. Use only verified staging rooms in the exercise.
3. Restore to a separate staging environment with compatible room storage. Verify that privacy, ban state, queue and host authorization survive. Resume the host and verify token rotation. Check that expired rooms and revoked members remain denied.
4. Validate audio/video, route and PWA behavior before restoring admission. Record restore time, recoverable data and sessions requiring rejoin. Legacy in-memory rooms require a drain and rejoin.

## Delayed call removal

Watch for `MEDIA_REMOVAL_DELAYED`, `MEDIA_REMOVAL_EXHAUSTED` and `MEDIA_REMOVAL_QUEUE_LIMIT`. Check the correct LiveKit project, credentials and provider availability. Verify the exact namespaced room and the participant's identity against the moderation incident before removing them in the provider console. Resolve the provider outage before re-enabling calls, and verify removal with provider participant state. A delayed job retries with a longer interval until its 24-hour limit. Fresh join tokens for that member are held while a removal job exists, and foreign or unscoped rooms remain outside automated removal.
