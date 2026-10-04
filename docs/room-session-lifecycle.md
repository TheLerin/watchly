# Room session lifecycle fix

## Root cause and inspection

`RoomLayout` rendered two different trees at the 1180px desktop breakpoint. Its desktop `main > .room-video-stage > VideoPlayer` became a mobile `div > .room-mobile-player-inner > VideoPlayer`. React replaced those ancestors and unmounted `VideoPlayer`, rather than moving the existing player.

That component owned the selected `File` reference, local media session reference, blob/playback URL state, remux session, native player ref and synchronization controller. Its unmount cleanup revoked the local file's blob URL, cleared the File and disposed remux playback. The new mobile/desktop player started with empty local state, despite the server still describing the same movie. Voice controls, `ScreenShareAdapter`, chat and their surrounding panel trees were also replaced at this breakpoint. The legacy voice/screen-share implementations own capture and cleanup, so those remounts could also stop those sessions.

The checked-in default LiveKit implementation already owned its Room above the desktop/mobile branches. Its connection effect depends on that Room, not theme, appearance or width. `RoomProvider` and the singleton Socket.IO client are also above the room presentation and have no theme/layout connection dependencies. No `key={theme/layout/width/isMobile}` was found. The inspection did not identify a separate theme-only Socket.IO/LiveKit reconnect path in this version. The fix preserves those existing owners, moves LiveKit composition outside presentation/restore guards, and tests their actual identities alongside the previously broken local player.

Cinema/Classic and Dark/Light remain appearance preferences. Compact theater fallback still changes only the effective layout, preserving the user's selected Cinema preference.

## Architecture after the fix

```text
App / existing RoomProvider + singleton Socket.IO
└── RoomLayout (room route)
    └── RoomSessionProvider (key: room code + stable member ID only)
        ├── in-memory File, local session and object/playback URLs
        ├── remux resource ownership and real-source/room-exit cleanup
        └── existing shared MediaCallProvider / LiveKit Room
            └── RoomPresentation
                ├── one persistent main / player wrapper / VideoPlayer
                ├── one persistent sidebar / voice / video / screen-share tree
                ├── presentation styles for Classic, Cinema and compact screens
                └── existing floating call portal
```

The responsive breakpoint changes classes, styles, visibility, panel headings and accessibility semantics on the same mounted ancestors. There is one `VideoPlayer` declaration and one instance of each media panel. The same native video, its source key, synchronization controller and playback position remain alive. Fullscreen continues to use the existing wrapper, and the floating portal keeps its existing relocation behavior.

## Local file ownership and cleanup

`RoomSessionContext` owns the File reference, local-source identity, blob URL, playback URL and remux resource. `installLocalFile` reuses the current URL for the same verified source; a real new source replaces and releases the previous resource. The provider observes only the authoritative local media session ID for source cleanup.

`VideoPlayer` consumes this state. Its own unmount cleanup no longer revokes the selected movie URL or clears the File. It still cleans up its timers, subtitle resources and controller listeners. Visual settings are not dependencies of source or connection cleanup. Pending file inspection cannot install a file after the owning room has ended.

Leaving the route/room, changing actual room/member identity, or losing membership releases the session resources. Selecting another source releases the former file URL. No File object, blob URL or playback position is saved to localStorage/sessionStorage; a real page reload still requires selecting the local file again. Existing storage remains limited to the already supported room credentials and appearance preferences.

## LiveKit and Socket.IO

The same `LiveKitMediaProvider` now composes inside `RoomSessionProvider`, above presentation guards and responsive UI. Its one Room and microphone/camera tracks remain owned there when tabs, styles or fullscreen change. No additional media connection, capture permission or token is requested by a layout change. The legitimate membership key still permits teardown when the actual room/member changes; call leave and provider departure keep their existing stop/disconnect behavior.

`App`'s existing `RoomProvider`, socket singleton, room recovery, account verification and synchronization protocol were left unchanged. Visual changes neither navigate the route nor recreate those owners. Guest-to-account upgrade keeps the same Watchly member identity, so it also keeps the local file and media session.

## Exact changed files

| File | Change |
| --- | --- |
| `frontend/src/context/RoomSessionContext.jsx` | New persistent File/URL/remux owner composed with shared LiveKit. |
| `frontend/src/components/RoomLayout.jsx` | Membership-scoped session wrapper and one stable responsive player/sidebar tree. |
| `frontend/src/components/VideoPlayer.jsx` | Consume provider-owned local media; remove layout-unmount file cleanup; fence late inspection after departure. |
| `frontend/src/components/room-panels.css` | Presentation-only compact tab, panel and decoration rules for the shared tree. |
| `frontend/test/roomLifecycleChecks.cjs` | Real File/player/LiveKit/socket identity and cleanup assertions across layout changes. |
| `frontend/test/browserVideoCall.cjs` | Run lifecycle checks inside the real Chrome/Edge/SFU media fixture. |
| `frontend/test/browserRoomPanels.cjs` | Observe the native pointer reaching the retained video; a first touch may be consumed by native video controls. |
| `docs/room-session-lifecycle.md` | This report. |

## Verification

The lifecycle fixture loads the same MP4 File independently in real Chrome and Edge, starts synchronized local playback, and keeps an active shared LiveKit camera/microphone session. It compares actual objects and identifiers, rather than only UI labels:

- File-to-blob mapping, blob URL and exact native video DOM node stay the same.
- Neither `loadstart` nor `emptied` occurs because of presentation changes.
- The LiveKit Room object, participant SID and local microphone/camera tracks stay the same and live; the previously muted microphone stays muted.
- No extra token requests, capture requests or Socket.IO connects occur. Socket ID and room membership remain the same.
- Local source ID and server readiness remain intact. Pure presentation transitions make no readiness reports. Explicit play/pause seeks can legitimately emit READY while decoding; those cases assert retained readiness and playback position rather than forbidding media status reports.
- The 32-transition matrix combines Cinema/Classic and Dark/Light with 1920x1080, 1180x650, 1179x650, 1024x768, 390x844, 844x390, 1366x649 and 1366x768. It crosses both width and theater-height limits and checks that compact fallback never overwrites the saved style preference.
- Tabs, floating restore, fullscreen entry/exit, paused resize and resumed playback exercise the same ownership checks.
- Actual source replacement must revoke both browsers' former File URLs while keeping the call alive; real room departure must revoke the final File URL and stop camera/microphone tracks.

Results on 2026-10-04: all combined lifecycle/media checks passed, all 111 frontend unit tests passed, ESLint and the production build passed. The existing full playback suite, drawer bounds/dismissal suite and account suite passed, including guest Host sign-in while retaining a private local blob. Build output has the existing bundle-size/Browserslist advisory warnings. No backend/protocol change was needed.

Reproduce the combined media/lifecycle test from the repository root:

```powershell
node frontend/test/browserVideoCall.cjs
node frontend/test/browserRoomPanels.cjs
node frontend/test/browserPlayback.cjs
node frontend/test/browserAccounts.cjs
```

The combined test requires the official LiveKit server binary via `LIVEKIT_TEST_SERVER` or the ignored local fixture path described in [video calling](video-calling.md). Its SFU and browser media transport are real; camera/microphone hardware is synthetic. This pass does not verify physical devices, Safari/iOS, or repeat the deployed Cloud media test. Native OS movie fullscreen/PiP still has the browser limits documented there.
