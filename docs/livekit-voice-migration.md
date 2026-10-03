# LiveKit voice migration

## Runtime and credentials

Render owns `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`. No
LiveKit credentials belong in Vercel, Vite variables or frontend source.
The frontend continues using its existing public `VITE_BACKEND_URL`.

`POST /api/livekit/token` requires `{ roomId, socketId, resumeToken }` from
the private Watchly session. It checks the current connected socket's exact
membership, resume-token hash and kicked-member set. Account memberships also
require `Authorization: Bearer <Supabase access token>` verified by the existing
account service. Membership is rechecked after asynchronous verification and
signing. Room codes, usernames, roles and socket IDs alone cannot authorize it.

The response contains only `serverUrl` and `participantToken`, is not cached,
and never includes the server signing secret or raw credential configuration.
Tokens expire in 120 seconds, target `watchly-voice-<ROOM CODE>`, and use
`watchly-<stable opaque Watchly member ID>` as participant identity. The server
derives the display name from the verified Watchly membership. Grants allow
room join, publication and subscription, restrict publication to microphone,
and disable data publication. They grant no LiveKit room-administration rights.
Token issuance is limited to eight joins per member per minute.

## Browser behavior

Mounting/joining/reloading a Watchly room does not request a voice token,
microphone or LiveKit connection. Join Voice performs token authorization,
then microphone capture, LiveKit connection and microphone publication.
Camera capture is never requested. LiveKit's React audio renderer attaches
remote audio; its Enable voice audio button handles blocked autoplay.

Controls show Join Voice, Leave Voice, Mute/Unmute, connection state, joined
participants, speaking and muted indicators. Leaving and unmounting disconnect
LiveKit and stop capture, including a microphone permission request that resolves
after cancellation. The controller fences stale asynchronous work and repeated
Join clicks. LiveKit reconnects its existing connection; joining Watchly alone
does not initiate one.

Socket.IO playback, roles, YouTube, local video, playlists, chat, queue,
Cinema Luxe, screen sharing and Supabase authentication retain their existing
implementations. The token route shares the existing account verifier.

## Legacy rollback

The complete prior component is retained in `VoiceRoomLegacy.jsx`; existing
WebRTC signaling handlers remain unchanged in `backend/realtime.js`.
The optional public frontend build selector `VITE_VOICE_PROVIDER=legacy`
restores that component. Its default is `livekit`; no new frontend environment
variable is required for migration. Clients in one room should use the same
provider. TURN remains optional for legacy voice/screen sharing; LiveKit Cloud
supplies its own voice transport. A configured TURN URL/secret must form a pair.

Do not remove the legacy implementation until the two-browser LiveKit media
test below has passed. Even after passing, cleanup must retain WebRTC screen
sharing and rerun its tests.

## Verification

Backend tests cover signed/scoped microphone tokens, active guest/account
membership, forged and cross-room credentials, departure/kick, stable identity
after reconnect, async membership races, issuance limits and configuration.
Frontend tests cover idle mounting, token-before-capture, cancellation during
authorization/capture, late microphone cleanup, duplicate clicks and failures.

The existing recovery suite explicitly selects legacy voice to keep rollback
verified with real peer connections, muted capture and network recovery.

Run the deployment media test from `frontend` with public test URLs:

```powershell
$env:WATCHLY_TEST_BASE_URL = 'https://wchly.vercel.app'
$env:WATCHLY_TEST_BACKEND_URL = 'https://watch-together-sui5.onrender.com'
node test/browserLiveKit.cjs
```

It launches separate Chrome/Edge processes with fake microphone WAVs at 440 Hz
and 880 Hz. It verifies zero capture/token/connection before Join Voice, both
participants, playing remote audio elements with decoded PCM from the opposite
microphone, speaking/muted indicators, mute silence, unmute audio restoration,
participant removal and stopped microphones on Leave Voice. Both Watchly
memberships, Host/Viewer roles and synchronization must remain intact. System
speaker output is suppressed; media and decoded remote audio remain genuine.
Evidence contains audio measurements and screenshots, never participant tokens
or signing credentials, in ignored `frontend/test/artifacts/`.

Deployment media test: **passed on October 3, 2026** against the public Vercel
frontend, Render backend and actual LiveKit Cloud transport. Separate Chrome and
Edge processes rendered/decoded the opposite microphone: A received B at
878.91 Hz (expected 880 Hz, RMS 0.150), and B received A at 439.45 Hz
(expected 440 Hz, RMS 0.146). Both remote audio elements were playing with ready
state 4. No token request, capture or connection occurred before Join Voice.
There was no camera capture or outbound video. Speaking/muted indicators worked;
mute silenced remote audio and unmute restored it. Leaving removed the LiveKit
participant and ended the microphone while both Watchly members, Host/Viewer
roles and synchronization remained intact. No browser exceptions occurred.

Additional checks passed: 53 backend tests, 93 frontend tests, ESLint,
production build, account browser suite, role/playback/YouTube/playlist/Cinema
browser suite, and the legacy recovery/media suite (including a real 60-second
outage). Preflight accepts LiveKit without coturn and rejects a missing signing
secret. The retained legacy component was compared against its prior source
and is unchanged. The LiveKit client is loaded as a separate lazy chunk.

Legacy implementation: **eligible for removal after the passing media test,
but deliberately retained for rollback**. Cleanup can now remove the old voice
component and voice-only signaling, while preserving screen-sharing WebRTC.

## Exact changed files

| File | Purpose |
| --- | --- |
| `backend/livekitVoice.js` | Protected token endpoint and configuration |
| `backend/server.js` | Register endpoint with shared verifier/membership store |
| `backend/package.json` | Server SDK dependency |
| `backend/package-lock.json` | Locked server dependencies |
| `backend/.env.example` | Backend-only LiveKit variable names |
| `backend/scripts/preflight.js` | LiveKit production configuration checks |
| `backend/test/livekitVoice.integration.test.js` | Token authorization/security tests |
| `frontend/src/components/VoiceRoom.jsx` | Voice provider selector and member-bound lifetime |
| `frontend/src/components/VoiceRoomLegacy.jsx` | Unchanged prior implementation, retained for rollback |
| `frontend/src/components/LiveKitVoiceRoom.jsx` | LiveKit room, controls, audio and participants |
| `frontend/src/components/livekit-voice.css` | Scoped voice styles using existing themes |
| `frontend/src/utils/livekitVoice.js` | Token request and capture/connection ownership |
| `frontend/package.json` | Three requested LiveKit dependencies |
| `frontend/package-lock.json` | Locked browser dependencies |
| `frontend/.env.example` | Optional public rollback selector |
| `frontend/test/livekitVoice.test.js` | Explicit-join/lifecycle tests |
| `frontend/test/browserLiveKit.cjs` | Two-browser genuine media verification |
| `frontend/test/browserRecovery.cjs` | Keep testing retained legacy rollback |
| `render.yaml` | Server-only deployment variable names |
| `docs/livekit-voice-migration.md` | Migration, rollback, files and test evidence |

Implementation references: [LiveKit token grants](https://docs.livekit.io/home/server/generating-tokens),
[room lifecycle context](https://docs.livekit.io/reference/components/react/concepts/livekit-room-component/),
[remote audio renderer](https://docs.livekit.io/reference/components/react/component/roomaudiorenderer/).
