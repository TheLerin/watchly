# Watchly shared LiveKit video calling

## 1. Exact files changed

| File | Change |
| --- | --- |
| `backend/livekitVoice.js` | Existing room-scoped token now permits microphone and camera sources. |
| `backend/test/livekitVoice.integration.test.js` | Signed camera/microphone grants and absence of admin privileges. |
| `frontend/src/components/LiveKitMediaProvider.jsx` | Owns the single shared Room, controller, audio renderer and connection state. |
| `frontend/src/utils/livekitMedia.js` | Shared authorization/connection, capture, publication, device switching and cleanup. |
| `frontend/src/components/RoomMediaCall.jsx` | Lazy shared provider/panels and existing legacy-mode compatibility. |
| `frontend/src/components/LiveKitVoiceRoom.jsx` | Voice controls consume the shared Room rather than creating another connection. |
| `frontend/src/components/VideoCallPanel.jsx` | Camera tiles, avatars, speaker/mute state, controls and device settings. |
| `frontend/src/components/FloatingVideoCall.jsx` | Floating portal, pointer drag/resize, minimize, restore and fullscreen relocation. |
| `frontend/src/utils/floatingCall.js` | Bounds, minimum size and compact mobile geometry. |
| `frontend/src/components/video-call.css` | Dark glass panel, camera grid and floating styles. |
| `frontend/src/components/RoomLayout.jsx` | Video toolbar/tab, one renderer mode and stable media provider above responsive layouts. |
| `frontend/src/components/room-panels.css` | Video drawer sizing and fifth Classic/mobile tab. |
| `frontend/test/livekitMedia.test.js` | Shared connection, privacy, cancellation, missing/unplugged camera, cleanup and geometry tests. |
| `frontend/test/browserVideoCall.cjs` | Real SFU/Chrome/Edge media, interaction, fullscreen and responsive verification. |
| `frontend/test/browserLiveKit.cjs` | Shared audio renderer, accessible mic labels and updated token grants. |
| `frontend/test/browserRoomPanels.cjs` | Scope shared error assertion to the visible Voice panel. |
| `frontend/test/browserPlayback.cjs` | Five-tab assertion and explicit legacy voice fixture for its existing rollback checks. |
| `frontend/test/classicDesktopChecks.cjs` | Keyboard End targets the appended Video tab. |
| `docs/livekit-voice-migration.md` | Current shared camera/microphone grant and connection flow. |
| `docs/video-calling.md` | This implementation and verification report. |

No new package installation is required: the existing installed LiveKit server/client and React component packages are reused. Playback/player, Socket.IO, Supabase auth, chat and queue implementations are unchanged.

## 2. One Room for voice and video

`LiveKitMediaProvider` creates one Room for the current Watchly membership and lives above Classic/Cinema/mobile panel branches. Voice, Video and Floating components use this same context. One controller coalesces concurrent token/connection requests. Switching panels, changing layout, minimizing or entering fullscreen does not connect again.

The existing server mapping remains `watchly-voice-<ROOM CODE>` so video joins the same media room as voice. Identity remains `watchly-<stable opaque Watchly member ID>`, verified server-side using exact active Socket.IO membership, private resume proof and Supabase verification for accounts. Camera/microphone grants do not grant room administration, screen-share or data publication. The response still contains only `serverUrl` and `participantToken`.

Render retains `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`; no new frontend environment variables or signing credentials are needed. Deploy both backend and frontend changes so newly issued tokens allow camera publication.

## 3. Camera publication

Only Join video / Turn camera on connects and calls `createLocalVideoTrack`, then publishes the camera source through the existing Room. Video-first joining leaves the microphone off; adding video to voice preserves its actual mute state. No role action remotely enables capture.

Camera off stops/unpublishes only the camera, retains membership and microphone, and displays an avatar fallback. Leave call disconnects both media streams. Voice's Leave Voice label changes to Leave call while the camera is enabled. Capture uses an initial 720p/24fps target, VP8 simulcast, adaptive streaming and dynacast.

## 4. Video tab

Classic/mobile receive a fifth Video tab; Cinema receives a Video call toolbar button and a drawer sized like existing drawers. It participates in the existing toggle, Escape, switch and outside-click behavior. Camera/microphone controls read actual SDK publication state, not separate UI booleans.

Tiles show name, local-user label, avatar/camera-off fallback, microphone status and subtle speaking border. One participant gets a large tile; two get columns; three/four get a 2x2 grid; larger grids scroll. SDK active speakers are prioritized, especially in compact floating mode. Device settings enumerate cameras/microphones only when opened and support active-device changes and front/rear switching where supported.

## 5. Floating overlay

The effective mode is `sidebar`, `floating` or `hidden`, derived from pop-out and active panel state. Floating mode replaces sidebar rendering with a restore placeholder, giving one active camera renderer. A dark glass window starts at 360x240, saves device-local geometry under `watchly-floating-call`, and can be restored, minimized or closed to the Video tab without leaving media.

The portal root has `pointer-events: none`; only the floating window accepts pointer events. Movie controls outside it remain available. Layer 180 places the call above movie content; device menus stay inside the call layer.

## 6. Drag

The title bar uses primary pointer events and pointer capture for mouse and touch. Interactive buttons do not start dragging. `touch-action: none` and prevented selection keep dragging stable. Updates are scheduled through animation frames, clamped to visible bounds; cancellation and cleanup release gesture state.

## 7. Resize

A corner handle uses pointer capture with the same bounds logic and supports arrow-key resizing. Desktop minimum is 260x180, constrained by the actual available viewport. Phone bounds use smaller useful minima and cap width/height to keep the movie accessible. Tiles adapt to the remaining window height with captions and controls retained.

## 8. Fullscreen relocation

React always portals into the same DOM container. That container is physically moved into the current paintable `document.fullscreenElement`, or back into `document.body` outside fullscreen. The portal target itself does not change, so fullscreen relocation preserves mounted tiles, tracks and Room ownership.

The floating header's fullscreen action uses the existing `.room-player-surface` wrapper, matching Watchly's existing custom fullscreen control. It does not change the player implementation or native movie PiP.

## 9. Fullscreen changes

`fullscreenchange` relocates the stable container, recalculates fullscreen-element dimensions and re-clamps saved geometry. `ResizeObserver` watches the fullscreen surface; window and visual viewport resize events handle viewport/orientation changes. Listener/observer cleanup occurs when floating UI closes. Fullscreen Escape retains the browser's behavior.

## 10. Mobile

Narrow portrait or short phone landscape windows use a compact card, at most 55% of viewport width (capped at 360px) and 55% of viewport height (capped at 240px). Compact mode prioritizes one speaker, simplifies visible button text while retaining accessible labels and Camera On status, and supports touch dragging. Orientation changes re-clamp the existing session and saved window rather than restarting media.

## 11. Permissions and errors

Watchly room join/reload requests neither token nor camera/microphone permission. Authorization succeeds before explicit capture. Camera denial shows Camera access blocked with Try again / Open without camera. Missing cameras and devices in use have distinct messages; an ended/unplugged camera is stopped/unpublished with a recovery message while voice remains connected.

SDK connection state supplies Connecting / Connected / Reconnecting. Signaling reconnection does not touch the Watchly socket or playback state. Device changes while hardware is off only save selection; they do not request capture.

## 12. Cleanup

Leave call, Watchly room departure and provider teardown stop both owned tracks, abort token requests, fence late permission/publish/device work and disconnect LiveKit. Camera-off separately fences pending camera capture. Late streams are stopped instead of being published after cancellation. Floating observers, animation frames, gesture state and portal mounts are removed on teardown. Reload starts with media off.

The previous voice implementation and signaling remain available via the existing `VITE_VOICE_PROVIDER=legacy` rollback. Video is unavailable in that mode; it does not start a second media system. The successful tests remove the original two-browser verification blocker, but this change deliberately retains rollback rather than deleting it.

## 13. Tests performed

Verification on 2026-10-04:

- Frontend unit suite: 111 passed, including 11 shared-media/privacy/geometry tests.
- Backend suite: 57 passed, including signed token scoping, guest/account authorization, revoked membership and existing playback roles.
- ESLint and production build passed. Build retains the existing bundle-size/Browserslist advisory warnings.
- `browserVideoCall.cjs`: separate real Chrome and Edge processes connect to the official LiveKit 1.13.7 local SFU. Only capture hardware is synthetic: distinguishable red/blue camera frames and 440/880Hz microphone WAVs. No SDK, transport, publication or remote track is mocked. Opposite decoded video colors/frame counters and decoded audio PCM verify media both directions (A received approximately 878.9Hz; B approximately 439.5Hz).
- One token per browser verifies shared connection; camera join preserves muted voice. Camera off produces remote fallback; mute silences remote PCM and unmute restores it. LiveKit's diagnostic signaling disconnect causes a real SDK signaling reconnect with media recovery and Watchly still synced.
- Pop-out, mouse drag, corner resize, edge clamp, wrapper fullscreen, fullscreen drag/resize, exit fullscreen, sidebar switches and restore preserve the session. The movie remains playing and is not replaced by these call interactions.
- Camera denial/retry/open-without-camera and device selection recover. Three/four participants produce the camera grid. Classic/Cinema were checked at 1920x1080, 1440x900, 1366x768, 1024x768, 390x844 and 844x390; logical viewport/DPR equivalents of 90%, 100% and 125% zoom and touch dragging were checked.
- Leave call removes media membership and ends captured tracks while all Watchly members remain. Refresh restores Watchly with no automatic token or capture. Minimize/X retain media; Watchly departure stops media and removes floating UI.
- `browserRoomPanels.cjs` passed both layouts at eight desktop/tablet/mobile sizes plus zoom equivalents, existing dismissal/modal behavior and unblocked movie interaction.
- `browserPlayback.cjs` passed remote/local playback, native controls/seeks, local readiness/reconnect, queue, roles, chat, screen sharing, appearance and Classic/Cinema layouts. Its original voice checks explicitly exercise retained legacy rollback; the separate SFU test covers the default LiveKit path.

Run from the repository root:

```powershell
node frontend/test/browserVideoCall.cjs
node frontend/test/browserRoomPanels.cjs
node frontend/test/browserPlayback.cjs
```

For the video test, set `LIVEKIT_TEST_SERVER` to an official local LiveKit server binary, or put it at the ignored `frontend/test/artifacts/livekit-server/livekit-server.exe`. The local fixture supplies test-only development keys and loopback ports; it needs no Cloud credentials. JSON evidence and screenshots are written to ignored `frontend/test/artifacts`.

## 14. Browser limitations

The new media verification used local SFU transport and synthetic devices; this pass did not repeat the deployed LiveKit Cloud test, test physical USB unplugging, or exercise Safari/iOS hardware. Missing/unplugged-device handling has controller tests. Zoom checks use logical viewport/DPR equivalents, not a browser settings menu.

Browser-native movie PiP is a separate browser surface and cannot display this in-app call overlay. Native fullscreen of a `<video>` or cross-origin iframe cannot paint Watchly HTML over it; use Watchly's wrapper fullscreen control or the floating header's fullscreen action for the overlay. Platform-native iOS fullscreen can have the same restriction. The app keeps the connection alive in those modes, but cannot override the browser/OS surface.

Camera and microphone require HTTPS or localhost, supported browser APIs and user permission. Device labels and front/rear selection depend on available hardware and browser support. Autoplay-blocked remote audio has an explicit Enable call audio action.
