# Cutover and rollback

Do not cut over until real-runtime and live-service acceptance passes and the user authorizes production deployment. Keep existing Vercel/Render deployments and Supabase/Auth redirect origins available. Do not enable billing or delete services as part of validation.

Before a cutover, record the current Worker version, frontend build/transport configuration, environment configuration and permitted OAuth callback URLs. Verify the two existing Supabase migrations and the new additive session-check function without resetting production data. Configure the same independent bridge secret on Worker/Render if fallback is needed. Test new/old clients, waiting service workers, media grants and active-room draining.

Existing Socket.IO rooms cannot transfer live authority to native Durable Objects. Let rooms drain, then have users reload/rejoin on the chosen origin. One frontend must select one backend. Cross-origin identical room codes are different rooms. Do not split a single room's events between backends.

For a regression, stop admitting new native rooms (`ALLOW_NEW_ROOMS=false`) and preserve existing compatible Worker instances while active rooms drain where possible. Restore the previous frontend/backend route only after an explicit drain/rejoin plan. Build the legacy frontend with an explicit Render URL and Socket.IO transport. Keep secure Drive middleware and configured secrets on Render; do not roll back to the public unauthenticated proxy.

Storage schema 3 is a forward migration from single-row schema 1 and granular schema 2. Older schema-2 Workers reject version 3; this intentionally prevents private-room policy from disappearing on rollback. Do not deploy a schema-1/2 Worker over active upgraded rooms. Use a schema-3-compatible rollback build or drain and rejoin. A production backup/restore has not been exercised.

Persistent Supabase accounts, friends and other database records are unchanged by this work. Rollback does not guarantee preservation of temporary room chat, queues, playback, guest credentials or active calls across backend changes. Keep service-worker caches and compatible assets available until old tabs exit; the new worker waits to activate rather than claiming active players.

Trigger rollback/rejoin if auth ownership, room isolation, authorized playback, media removal or streaming Range checks fail. Record provider errors and request correlation IDs without tokens/cookies. Never delete production data to make a test pass.
