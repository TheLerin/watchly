> Historical migration baseline. Current V2.1 changes, unresolved issues and evidence are in [REMEDIATION_REPORT.md](REMEDIATION_REPORT.md), [TEST_REPORT.md](TEST_REPORT.md) and [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Counts and architecture details below describe the earlier migration, not the complete current source.

# Watchly Cloudflare audit

Audit date: 2026-11-26. Initial working tree: two unrelated untracked images (`cloudformation-devadath.png`, `s3-bucket-devadath.png`); preserved.

## Existing architecture

- React 19 + Vite 7 SPA, React Router, Tailwind, Framer Motion, PWA; Vercel middleware rewrites room preview metadata. All presentation components remain in place.
- Express 5/HTTP + Socket.IO 4 on Render. `backend/realtime.js` owns validated room events, resume-token hashes, role permissions, canonical local-file playback, queues, YouTube playlists, bounded chat, legacy voice and screen signaling.
- Supabase Auth/PostgreSQL/storage and browser Realtime own profiles, friends, invitations, notifications and account data. Two SQL migrations include RLS and restricted invitation RPC. No D1 migration needed.
- LiveKit is the current microphone/camera SFU; legacy peer-to-peer voice is selectable. Screen Share Beta uses peer-to-peer offers/answers/ICE with three viewers. coturn REST credentials are generated server-side.
- Google Drive proxy currently scrapes public download interstitials using Axios/Node streams and redirects. It has no room access check and insufficient redirect validation. This path must become an authenticated bounded streaming handler; provider access restrictions must remain errors.
- Local movies stay on devices. Fingerprints, container inspection, remuxing, subtitle parsing, audio/subtitle selection and drift correction execute in the browser.
- Social presence currently aggregates all sockets in one process; a per-room migration needs a separate cross-room presence directory.
- Account login/logout, email and Google OAuth, session recovery, profile setup, friends/search/invites, recent rooms, themes, appearance panels, sound settings, responsive layouts, floating video call, direct/HLS/DASH/embeds, YouTube and playlists, media readiness, moderators/host transfer/kicking, queues, chat and reconnection are present. No standalone reaction event or persistent room/watch-history table was found; emoji chat remains chat, recent rooms are local storage.

## Compatibility and implementation decisions

1. Reuse the existing event/permission/playback reducer through an in-process event adapter. Native WebSockets carry explicit versioned frames, not Socket.IO wire packets. Keep the old server and deployment files for rollback.
2. One SQLite Durable Object per seven-character room code, with persisted room state and WebSocket metadata. Use hibernation attachments and alarms; inject scheduling into the shared engine so Node timers are not required in Workers.
3. A private presence directory supplies friend-authorized status across room objects; it never publishes room codes to friends.
4. Centralized frontend endpoint/transport selection. Existing explicit backend URLs retain the legacy deployment path; same-origin builds use native WebSockets.
5. Workers APIs: health, public STUN config, authenticated room TURN config through events, room-authorized LiveKit token, authorized Drive streaming. Preserve room social previews.
6. `frontend/public/bg-video.mp4` initially measured 40,163,902 bytes, over the 25 MiB asset ceiling. Per the user's correction, full-loop FFmpeg H.264/VP9 encoding replaces both desktop/mobile assets; no chunked delivery is implemented. Posters, visibility loading and reduced-motion/data-saver fallback are included.
7. Database schema/RLS stay unchanged. Auth verification remains Supabase `getUser`; user-scoped REST access stays user-scoped. The invitation RPC alone needs the existing service-role key.
8. Required secrets: existing Supabase keys; optional LiveKit and coturn secrets. No production deploy, DNS edit, billing activation or retirement of existing hosting is authorized.

## Event inventory

The authoritative generated mapping is `shared/event-map.json`, created from literal `socket.on(...)` and outbound `.emit(...)` calls before transport replacement. Every discovered handler is retained in the shared room engine. Adapter tests and Worker integration tests must cover the runtime boundary rather than replacing the domain logic with placeholders.

## Validation boundaries

Existing Node suites exercise permissions, account SQL/RLS, playback, playlists, social state and legacy transport. New local workerd tests must additionally exercise native transport, persistence, room isolation and APIs. Real Supabase OAuth, Google Drive delivery, external TURN/LiveKit and mobile hardware permissions need their real credentials/services and cannot be claimed from a compile or local fixture.
