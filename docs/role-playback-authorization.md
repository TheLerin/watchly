# Role authorization and player interaction repair

## 1. Why Moderator actions failed

Both the frontend's `isPrivileged` flag and the server's playback/source/queue helper required the member UUID to equal `room.controllerMemberId`. Promotion changed the member's role but did not change that UUID. The canonical local-file command handler and playlist navigation also required this single controller. Consequently, a promoted Moderator needed a separate “Take playback control” action, and taking it removed the Host's normal controls.

Playback permission is now independent of coordination. Host and Moderator may issue normal shared commands at any time. An accepted play/pause/seek/source/navigation command makes its actor the coordinator, which is still the single progress/discovery/automatic-end publisher. The existing control-request action remains optional, especially for screen sharing.

## 2. Role names

Server, snapshots and frontend consistently used `Host`, `Moderator`, and `Viewer`. No case or enum mismatch was found. “Mod” was a badge abbreviation, not a stored role; the badge now says “Moderator”.

## 3. Frontend permissions

The frontend reads server-published capabilities through `getRoomPermissions`; missing capabilities deny access. RoomContext validates the latest capabilities immediately before emitting commands, including callbacks that were created before a role change. Promotion, demotion, control changes, joins and recovery snapshots refresh them. Demotion cancels pending local seek scheduling and play/pause/seek debounce work. Source controls, playlist controls, queue controls and member actions all use this policy.

## 4. Server/socket permissions

`backend/permissions.js` computes capabilities exclusively from server-owned membership and coordinator identity. Every shared playback, source, local declaration, playlist navigation, queue and member-management handler validates the bound room and actual sender. Claimed roles or permissions in client payloads do not grant authority. Local commands retain validation, readiness, command deduplication, source fencing, sequence numbers and their scheduled effective deadline.

`sync_progress`, automatic completion, playlist `RESOLVE`/`ERROR` and screen-sharing initiation remain coordinator-only. Playlist `READY` remains available to all members. Member management checks the target as well as the actor. `reorder_queue` is a new bounded action accepting `{roomId, itemId, direction: 'up' | 'down'}`; it swaps a neighboring server-owned item rather than trusting a replacement client queue.

## 5–7. Resulting role policy

| Action | Host | Moderator | Default Viewer |
| --- | --- | --- | --- |
| Shared play, pause and seek | Yes | Yes | No |
| Direct/YouTube source, playlist loading, local-file initiation | Yes | Yes | No |
| Playlist Next/Previous/select | Yes | Yes | No |
| Queue add/remove/reorder/play-next | Yes | Yes | No |
| Kick a Viewer | Yes | Yes | No |
| Kick a Moderator | Yes | No | No |
| Kick the Host or yourself | No | No | No |
| Assign/remove Moderators; transfer ownership | Yes | No | No |
| Local volume/mute/fullscreen; supported native PiP | Yes | Yes | Yes |
| Existing local audio/subtitle selection, chat and voice | Preserved | Preserved | Preserved |

The existing server-selected controller fallback after a disconnect is preserved: a Viewer explicitly selected by that server policy receives playback capabilities. Ordinary Viewers remain read-only. There is no existing “Everyone can control” setting to interpret. Room-wide end/lock/delete/security-setting endpoints do not exist in this application; this repair adds no such endpoints. Host-only settings/ownership capabilities remain Host-only, while personal Appearance settings remain personal.

## 8–9. Viewer pause and seeking

The previous transparent overlays covered native controls, but could not prevent an OS/native/iframe pause. Unauthorized callbacks then returned without restoring playback; position correction did not reliably restart a paused player.

Viewers now receive an explicit read-only progress display and local volume/mute/fullscreen/PiP controls. Native and YouTube shared transport controls are disabled for them, including room keyboard shortcuts. Subtitle/audio controls retain their local behavior.

Unexpected native or iframe play/pause/seek events are classified against the authoritative playing state and room-clock position. A divergence requests a fresh room snapshot and uses the existing temporary player restoration operation. Playing rooms resume at the expected position; paused rooms remain paused. Player identity is preserved. YouTube's adapter does not forward native `onSeek`, so its existing progress callback also detects actual position discontinuities and restores an unauthorized seek, including while paused.

During divergence a small status and “Sync to Room” fallback appear, with controls revealed. The explicit fallback can retry a failed resync and invokes playback within the click gesture when a playing room needs browser autoplay permission. Existing autoplay-blocked prompts remain available. There is no permanent force-play loop and no unauthorized shared command.

## 10. Feedback-loop prevention

One event classifier distinguishes permitted user interactions, expected room playing/paused transitions, programmatic seek targets and recovery/source/track-switch suppression. Events caused by authoritative application do not become socket commands or start another recovery. Existing scheduled local synchronization is reused. Only the coordinator publishes periodic progress and completion, preventing a second permitted controller from echoing a remote correction. YouTube native seek detection uses time discontinuity and the programmatic seek marker instead of forwarding every progress sample as a seek.

## 11. Auto-hide

Cinema Luxe keeps chrome visible while a pointer or touch is held, a native control region or local toolbar is hovered, an interactive control has keyboard focus, a settings/menu/drawer is open, playback is paused, autoplay is blocked, or Viewer recovery is active. Pointer/touch release resumes the normal inactivity timer. Movement, taps, keyboard input and player recovery reveal controls. Only a window blur clears held-input tracking; a control losing focus during a drag does not. Compact layouts retain their existing always-accessible behavior. Room geometry and theme architecture are unchanged.

The mobile queue check also exposed informational toast bars covering queue actions and pausing their own dismissal while hovered. Their bars and positioning wrappers now let pointer/touch input pass through. Queue removal remains visible on touch devices rather than requiring hover.

## 12. Files changed

Production:

- `backend/permissions.js`, `backend/realtime.js`
- `frontend/src/utils/roomPermissions.js`, `frontend/src/utils/playerInteraction.js`
- `frontend/src/context/RoomContext.jsx`
- `frontend/src/components/VideoPlayer.jsx`, `frontend/src/components/UserQueueSidebar.jsx`
- `frontend/src/components/player/ViewerPlayerControls.jsx`, `PlaylistControls.jsx`, `ScreenShareAdapter.jsx`
- `frontend/src/hooks/useCinemaLuxeEffects.js`, `frontend/src/components/cinema-luxe.css`
- `frontend/src/App.jsx`, `frontend/src/index.css` (informational notification input handling)

Verification/documentation:

- `backend/test/realtime.integration.test.js`, `backend/test/youtubePlaylist.integration.test.js`
- `frontend/test/playerInteraction.test.js`, `frontend/test/browserRoles.cjs`, `frontend/test/roleAutoHideChecks.cjs`
- `frontend/test/browserPlayback.cjs`, `frontend/test/classicDesktopChecks.cjs`
- This report.

## 13. Verification

All commands below passed on 2026-10-03. The local preview backend was restarted and verified to publish the new Host capabilities; the frontend at `http://localhost:5173/` returned HTTP 200. Existing local in-memory rooms expire across that restart, so start a fresh room for manual verification.

Run from `backend`: `node --test` (31 tests).

Run from `frontend`:

- `node --test test/*.test.js` (74 tests)
- `node node_modules/eslint/bin/eslint.js .`
- `node node_modules/vite/bin/vite.js build`
- `node test/browserRoles.cjs`: three isolated Chrome contexts with Host, Moderator and Viewer. Immediate promotion, Moderator pause/play/seek to 90 and rapid seeks, mobile Moderator queue operations, source changes, demotion during a pending seek, local same-file readiness and scheduled commands, role-preserving reconnect, genuine YouTube and playlist navigation on desktop/tablet, Viewer private pause/seek/play correction (including paused YouTube seeking), local controls, mobile touch and Cinema Luxe interaction holds. Outgoing messages are observed to assert no Viewer playback writes; browser exceptions fail the test.
- `node test/browserPlayback.cjs`: existing direct/local playback, readiness, drift, seeking, source switching, automatic queue advancement, member controls/kick, chat, Classic/Cinema settings and responsive layouts. Voice uses a synthetic microphone and screen sharing a synthetic capture; those checks do not claim a real remote call.
- `node test/browserPlaylist.cjs`: genuine YouTube iframe discovery, navigation, late join, resume, seeking, completion and queue integration.
- `node test/browserRecovery.cjs`: actual transport outages, including the default 60-second outage, snapshot/player restoration, source fencing, local files, intentional leave, expiration and server restart.

Chrome automation emulates mobile viewport/touch; it does not represent physical iOS/Android OS suspension or every platform's native media controls. Non-YouTube providers retain ReactPlayer local-volume integration but are not part of the real-provider playback matrix. Server restart still expires in-memory rooms.
