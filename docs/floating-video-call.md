# Compact floating Video Call

Floating mode now renders the camera surface edge to edge with a 16px rounded frame, subtle border and shadow. It has no heading, connection/camera status row, device menu, full-size action rows or outer padding. The normal Video sidebar retains its existing controls, device settings and self preview.

Only remote participants render in floating mode. One remote fills the frame; several use the compact grid, with active-speaker priority and a single active remote on narrow frames. Camera-off remote participants retain avatar/name fallback. With no remote participants, the frame says “Waiting for others…”. Filtering self never mutes, stops or unpublishes the local camera.

Mic, camera, fullscreen, minimize, restore and close controls are icon-only, with accessible names and native title tooltips. Mouse entry/movement reveals the gradient overlay; idle/leave hides it after two seconds. Hovering controls, keyboard focus and active gestures keep it available. Touch taps toggle the overlay and it hides after three seconds. Camera permission errors remain accessible inside the frame; retry uses the camera icon or sidebar controls.

Drag starts on the video surface, with a movement threshold to distinguish touch taps. Buttons do not drag the frame. All four edges and corners resize the frame, with 26px corner targets and directional cursors. A subtle bottom-right grip appears on interaction; arrow-key resizing remains available. Top/left resizing preserves the opposite edge, allowing enlargement inward when the frame starts against the bottom-right viewport corner. Controls sit above the corner targets to avoid overlap. Both gestures clamp to the viewport/fullscreen bounds. Minimize, restore and close preserve microphone/camera publications. Each new pop-out starts with controls hidden.

The existing stable fullscreen portal is retained: its DOM container moves into the movie wrapper without changing React's portal target. No provider, LiveKit controller, Socket.IO connection, playback or local-file lifecycle code changed.

## Exact files changed

| File | Change |
| --- | --- |
| `frontend/src/components/FloatingVideoCall.jsx` | Icon overlay, desktop/touch idle behavior, surface drag, camera/mic actions and accessible errors. |
| `frontend/src/components/VideoCallPanel.jsx` | Dedicated remote-only floating surface using existing camera tiles. Normal sidebar behavior retained. |
| `frontend/src/components/video-call.css` | Floating-only edge-to-edge video, fade, compact buttons, caption and handle styles. |
| `frontend/src/utils/floatingCall.js` | Edge/corner resize geometry that preserves the opposite edge and viewport limits. |
| `frontend/test/livekitMedia.test.js` | Corner enlargement, minimum size and edge bounds regression. |
| `frontend/test/floatingCallChecks.cjs` | Real two-browser compact UI, publication, controls, idle/touch, fallback and empty-state checks. |
| `frontend/test/browserVideoCall.cjs` | Runs compact checks, drags video surface, reveals overlay before actions and checks three remote tiles with four call members. |
| `frontend/test/roomLifecycleChecks.cjs` | Reveals overlay for fullscreen/restore while retaining lifecycle assertions. |
| `docs/video-calling.md` | Updates floating/drag/fullscreen description. |
| `docs/floating-video-call.md` | This report. |

## Verification

- Lint, production build and all 112 frontend unit tests pass.
- Separate Chrome and Edge browser processes use the official local LiveKit 1.13.7 SFU with synthetic capture hardware. Actual subscribed video frames and PCM audio are decoded; LiveKit/signaling/publications are not mocked.
- A pops out and sees only B filling the frame; B continues decoding A's transmitted camera. Floating mic mute/unmute changes remote audio, and camera off/on changes B's received video. Own camera off leaves B visible. Remote camera off shows B's avatar/name. B leaving gives waiting state while A's camera remains published.
- Desktop idle/leave hide, control hover and keyboard focus hold, touch tap toggle/three-second hide, camera denial/retry, drag, viewport clamping, minimize and restore pass. Actual top-left enlargement, edge-only resizing, keyboard resize and touch corner resize change the rendered frame dimensions without reconnecting.
- Restore returns the normal sidebar including self preview. Fullscreen retains the floating frame and shared call. Four-member calls show three remote tiles in the desktop floating grid.
- Existing lifecycle regression passes 32 breakpoint/style/theme transitions, tab switching, fullscreen and paused/playing local video: same File, object URL, movie DOM node, LiveKit Room/participant/tracks and Socket.IO identity; zero extra captures/tokens, reconnects or readiness resets during presentation changes.

Ignored screenshots and JSON evidence are under `frontend/test/artifacts`. Testing used local SFU and synthetic devices, rather than deployed Cloud or physical mobile hardware. Touch events were exercised in Chromium; Safari/iOS native fullscreen remains subject to the browser's existing HTML-overlay restrictions.
