# V2.1 verification additions

Current outcomes and limitations: [TEST_REPORT.md](TEST_REPORT.md), [REMEDIATION_REPORT.md](REMEDIATION_REPORT.md). Existing UI/features remain, with these boundary changes:

| Area | Implementation | Evidence / remaining gate |
|---|---|---|
| Queue | Negotiated deltas, revisions and snapshot recovery; old clients retain array events | Reducer/Worker tests and Chromium queue/gap checks |
| Storage/reconnect | Schema-3 records, transaction migration, credential re-supply after hibernation | SQLite and actual workerd idle reconstruction pass; external acceptance pending |
| Drive | Room-selected grants on both transports and signed optional fallback | Authorization/Range/redirect fixtures; actual Google delivery and cross-site cookies pending |
| Screen share | Authorized late viewers within the existing three-viewer cap, departure cleanup and queued ICE | Server signaling tests; hardware/audio/NAT pending |
| PWA | Waiting activation and hashed-only immutable bundles | Build verified; multi-version active-tab upgrade pending |
| Stronger room policy | Password/private/account-only/approval/locking/revocable invite/unban controls | Worker and actual Chromium approval/private/password flows pass |
| Reactions/history | No standalone reactions or persistent watch-history feature discovered in the earlier audit | Existing emoji chat/local recent rooms retained |

The earlier migration inventory follows as historical coverage, not an external verification claim.

# Feature parity

Every feature found in the audit is listed below. “Verified” identifies the named local test scope; it does **not** mean deployed on Cloudflare or verified against live providers. Real workerd/external verification remains a release gate. Existing Vercel, Render, Supabase migrations and legacy Socket.IO paths are retained.

| Feature | Existing implementation | Cloudflare implementation | Coverage / result | Status | Remaining configuration or limit |
|---|---|---|---|---|---|
| SPA, routing and direct room links | Vite/Router + Vercel rewrites | Static Assets SPA routing; Worker room preview | Build + API routing/metadata tests pass | Implemented and verified | Real Workers navigation/browser suite pending |
| Original room/landing UI, animations, themes, appearance and layouts | Existing React components/CSS | Components retained; transport imported centrally | Existing appearance/unit tests and lint pass | Implemented but not externally verified | Complete visual/device regression on staging |
| Background desktop/mobile animation | 40.2/13.6 MB H.264 with audio | Full-duration FFmpeg H.264 + VP9, no audio, posters, visibility loading, reduced motion/data saver | Encoding/size/SSIM diagnostics and representative frames checked | Implemented and verified | Encoding reduces desktop from 60 to 30 fps; original loop timing/cut unchanged |
| PWA | VitePWA/service worker | Retained; API/WS navigations excluded; background video not precached | Production build passes | Implemented and verified | Real service-worker upgrade/offline behavior on deployment |
| Room social previews | Vercel middleware | Worker modifies current deployment shell | Existing metadata + Worker API tests pass | Implemented and verified | Set actual public origin for homepage SEO |
| Email/Google login, logout, session persistence | Supabase Auth/browser provider | Existing provider retained; Worker `getUser` verification | Account recovery/unit and backend Auth-boundary tests pass | Requires credentials | Existing project keys, allowed return origins, real OAuth/email |
| Profiles and avatars | Supabase/RLS | Same project/tables/client | Real PGlite profile ownership/search tests pass | Implemented but not externally verified | Existing public Supabase configuration |
| Friends/search/requests/block/unblock | Supabase RPC/RLS + private Realtime | Unchanged DB; native social event transport | Existing social store + real PostgreSQL RLS tests pass | Implemented but not externally verified | Existing DB migrations/publications and actual Realtime |
| Online/in-room friend presence | Single Render process socket registry | Private indexed presence DO + room callbacks | Cross-object friends-only/no-room-code/revocation fixture passes | Implemented and verified | Provider-backed friend queries and fan-out under load need staging |
| Friend room invitations/notifications | Verified backend + restricted Supabase RPC | Shared engine, same RPC and user identity | Existing real PostgreSQL invite/RLS tests pass | Requires credentials | Existing backend service-role secret; no browser service key |
| My Watchly and recent rooms | Supabase social projections + browser local storage | Retained | Existing projections/recent-room unit tests pass | Implemented but not externally verified | Actual account/browser verification |
| Room create/join and guest membership | In-memory Socket.IO engine | Shared reducers in per-room SQLite DO, native transport | Worker harness create/join/identity/isolation tests pass | Implemented and verified | Direct workerd and Chromium pass; HTTP listener gate remains blocked |
| Resume and reconnection/network interruption | Resume hashes + browser recovery | Same membership semantics, native jitter/backoff, ACK correlation, snapshot recovery | Native transport + SQLite eviction/resume tests pass | Implemented and verified | Actual workerd idle eviction passes; real network interruption remains a gate |
| Host/moderator/viewer permissions, transfer, kicking | Server-owned role reducers | Same reducers; bound-room enforcement | Worker permission/moderator/kick tests + existing permission utilities pass | Implemented and verified | Staging two-device verification |
| Host migration, room expiration/cleanup | Node timeout callbacks | Injected alarm scheduler, restored deadlines | Evicted host-lease/empty-room cleanup tests pass | Implemented and verified | Actual alarms/hibernation platform verification |
| Chat and emoji text | Bounded text events/history | Same handler/history persisted with room | Native room chat/dedup tests pass | Implemented and verified | Browser/external runtime gate |
| Standalone reactions | No standalone server event found | No invented replacement | Event inventory checked | Not applicable | Existing emoji chat remains available |
| Queue/reorder/remove/next | Shared room queue | Same reducers, persisted bounded queue | Worker queue/moderator tests + original reducer logic retained | Implemented and verified | Browser all-action regression pending; 500-item bound |
| YouTube videos/playlists | Browser YouTube API + server identity/revision state | Same browser discovery; same engine in DO | Existing playlist unit tests + Worker discovery/navigation/restore tests pass | Implemented but not externally verified | Actual YouTube embeds/API availability |
| Direct URLs, HLS/DASH, supported embeds and Archive | ReactPlayer/native browser + source resolver | Same player/source integration | Existing source/playlist/player tests pass | Implemented but not externally verified | Third-party CORS, codecs and provider availability unchanged |
| Google Drive streaming/seeking | Axios public-download proxy | Selected-file room authorization, signed cookie, Fetch streams/Range/redirect validation | Fixture 206/HEAD/416/SSRF/access-denial tests pass | Implemented but not externally verified | `MEDIA_SESSION_SECRET`, real Drive checks; optional fixed legacy adapter for provider-blocked delivery |
| Local files remain local | Browser File/blob/fingerprint | Unchanged local ownership; only manifest/control state reaches DO | Fingerprint/container/remux/subtitle/player tests + metadata-only Worker tests pass | Implemented and verified | Real two-browser codec/media fixture and mobile device checks |
| Local readiness/play/pause/seek/ended | Canonical timestamp/sequence reducer | Same reducer persisted; state/command deduplication | Existing playback/math/synchronizer + Worker local command/restore tests pass | Implemented and verified | Real video playback and buffering recovery gate |
| Drift correction, clock, foreground recovery | Local rate/seek correction and clock estimates | Preserved; fewer idle samples, drift-driven progress publishes | Existing synchronizer/recovery unit tests pass; read-only packets don't rewrite state | Implemented and verified | Latency/drift measurements are not yet production benchmarks |
| Audio/subtitle selection, parsing and remuxing | Browser workers/MediaSource/mediabunny | Unchanged | Existing parser/inspection/remux/fingerprint tests pass | Implemented and verified | Browser codec support remains device-dependent |
| LiveKit voice + camera | Shared LiveKit room, explicit capture, scoped backend JWT | Same frontend session; Worker WebCrypto JWT/RoomService provider | Existing capture/cleanup unit tests; existing SDK verifies Worker tokens/admin grants | Requires credentials | Existing LiveKit URL/API key/secret, real calls and quotas |
| LiveKit kick/ban media enforcement | Previously UI/application-only kick | Durable server-side removal job + signed webhook admission cleanup | Job persistence/token denial/admin request/signature tests pass | Implemented but not externally verified | Configure existing LiveKit webhook; verify actual removal/rejoin. Self-hosted revocation limitation documented |
| Floating call and independent mic/camera controls | Existing shared LiveKit media owner | Retained, vendor imports behind provider boundary | Existing media-session/floating geometry tests pass | Implemented but not externally verified | External SDK track/device behavior needs real-device checks |
| Legacy peer-to-peer voice | Selectable WebRTC implementation | Same legacy provider/events through native room adapter | Authorized offer relay fixture passes | Implemented but not externally verified | Browser microphones, NAT and TURN |
| Screen Share Beta | P2P signaling, one sharer/three viewers, bitrate limit | Same implementation; DO signaling and estimated local usage safeguards | Authorized room-only screen relay/start/stop fixture passes | Implemented but not externally verified | Actual display capture, browser/system audio, NAT/TURN and mobile support |
| TURN/STUN | Public STUN and coturn short-lived HMAC credentials | Same semantics with Worker-compatible crypto | Public config excludes TURN secrets; credential/signaling tests pass | Requires credentials | Existing coturn URL/shared secret; relay verification on restricted networks |
| Media provider extensibility | LiveKit-specific imports | Server token/remove/webhook contract + centralized frontend SDK adapter | Provider selection/signature tests pass | Implemented and verified | Future Cloudflare adapter must implement contract and pass full media suite; none enabled |
| RTC usage safeguards | Screen bitrate/viewer cap | Preserved caps plus optional estimated session byte budget | Counter/reset/one-shot budget test passes | Implemented and verified | Client estimate is not a hard provider billing cap |
| Sounds | Local sound preferences/notifications | Unchanged | Existing sound generation/preference/dedup tests pass | Implemented and verified | Browser audio unlock behavior unchanged |
| Persistent room/watch-history tables | Not found; rooms were temporary, recent rooms local | No new DB history tables | Schema audit | Not applicable | Existing persistent account/social data remains in Supabase |

No external service has been discontinued. The isolated legacy Drive adapter is the only optional Render dependency in the new deployment. No current room can be controlled by both protocols in one build; existing legacy rooms must drain during cutover.
