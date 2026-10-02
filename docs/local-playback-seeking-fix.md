# Local playback seeking: diagnostic report

## 1. Root cause of the permanent pause

The player uses native `<video controls>`. In the Chrome trace, native timeline interaction queued a `pause` event **before** `seeking`. At the pause handler, the element already exposed `seeking === true`; for a quick click, it could also have resumed with `paused === false`.

The old local `onPause` handler treated that event as an intentional user pause and sent `playback:command` with action `PAUSE`. The server correctly preserved its resulting paused status when the following `SEEK` arrived. Applying that canonical state stopped the controller and receiver. This was an application event-ordering problem, not a native requirement to play after every seek.

## 2. Root cause of the delay

Native controls already changed local `currentTime` immediately. The application then waited for `seeked`, debounced sending the seek for 300ms, and applied the returned position at the existing shared deadline 750ms after server receipt. That old position could pull an already-advancing controller backward, in addition to the false pause. Network synchronization was delayed even though the initial native position change was local.

## 3. Production files changed for playback

- `frontend/src/components/VideoPlayer.jsx`: local native event classification, optimistic seek tracking, stale-confirmation protection, and queue cleanup.
- `frontend/src/utils/seekCommandScheduler.js`: immediate leading send and coalesced trailing sends, capped at five seek commands per second during dragging.
- `frontend/src/context/RoomContext.jsx`: preserve the caller's command ID and pass seek metadata/results through `seekVideo`. Join/leave notifications were also moved out of React state updaters to remove the console warning found during validation.
- `frontend/src/utils/playbackCommands.js`: optional local-file seek timestamp; URL/embed payloads retain their existing shape.
- `backend/realtime.js`: validate and forward the optional timestamp while retaining authority, rate limits, deduplication, and sequence handling.
- `backend/playback/canonicalState.js`: compensate playing seeks for elapsed time through the shared deadline. Timestamp compensation is bounded; paused seeks remain exact and older clients retain their existing behavior.

The same push also includes the previously completed Classic desktop layout in `RoomLayout.jsx`, `classic-desktop.css`, the player panel accessibility props, and its browser checks.

## 4. Events and functions changed

Local native `onSeeking` sends the browser's already-applied position immediately and suspends conflicting correction. Local `onSeeked` finishes the existing programmatic-seek marker without the old 300ms send delay. Local `onPause` checks the current element's `paused`, `seeking`, and programmatic-seek marker. Local `onPlay` ignores seek-related events. Explicit play/pause flush any queued final seek first.

`seekVideo`, `sendPlaybackCommand`, and `playbackCommand` carry the command ID and `requestedAtServerMs`. The canonical reducer uses the timestamp only for playing local-file seeks. The existing URL/embed debounce remains separate.

## 5. Local-first behavior

The browser's timeline changes `currentTime` before the application sends synchronization. Neither decoding completion, socket acknowledgement, nor returned room state is required for that local change. The 200ms timer coalesces network traffic only; it does not delay local seeking or resume playback.

## 6. Play/pause intent

Native seeking preserves its own pre-seek intent. Canonical `SEEK` leaves `playback.status` unchanged. Suppressing the false `PAUSE` keeps these consistent: playing seeks remain playing, paused seeks remain paused. No unconditional `play()` was added to `seeking` or `seeked`.

## 7. False pause prevention

A local pause event is ignored if the element has already resumed, is seeking, or is applying a synchronized seek. The existing controller and connection checks remain in place. Genuine native pause requests still use the existing shared pause behavior, with rejected play promises handled by the existing error handler.

## 8. Races and feedback loops

Each user seek has a command ID. Older confirmations from the same controller cannot replace a newer pending target, including one still queued by throttling. Starting a fresh seek cancels an older scheduled application. Existing playback sequence gates reject stale revisions. The synchronizer's programmatic-seek marker and controller checks prevent receivers from echoing remote seeks. Pending sends are canceled on source changes, disconnection, loss of control, and unmounting.

## 9. Object URLs and remounting

The traced native-file path kept one stable blob URL and one stable video element; neither caused the bug. Browser checks verify both identities survive clicks, dragging, rapid seeks, and confirmations. The file remains local to each participant. Existing subtitle and audio-remux machinery was not redesigned.

## 10. Validation

- Frontend: 42 unit tests, including local-only timestamp metadata, scheduler coalescing/flush/cancel, sequence protection, and programmatic seek handling.
- Backend: 21 unit/integration tests, including timestamp compensation, paused/legacy seeks, bounded timestamps, duration clamping, two-client broadcasts, duplicate command IDs, malformed metadata, and controller authority.
- Chrome native mouse and emulated touch with two clients: playing/paused clicks, forwards/backwards, five rapid seeks, drag release, actual play/pause controls, delayed outbound commands and inbound confirmations, no false play/pause broadcasts, no receiver echoes, stable DOM/source, and no console errors or unhandled promises. Run `node test/localSeekBrowser.cjs` from `frontend`; set `SEEK_TEST_APPEARANCE=cinematic` to cover Cinema Luxe as well.
- The full browser suite covers direct URL synchronization, local readiness, subtitles, audio selection, source switching, ending/replay, reconnect, moderator authority, queue advancement, screen sharing, appearance, and desktop/compact layouts.
- A separate real YouTube check used two clients to verify playback, synchronized pause/play, and a playing seek. Third-party analytics requests aborted independently of playback.
- ESLint, production build, and Git whitespace checks.

Cinema Luxe's existing screen-expansion animation can move the physical native track during scrubbing. The drag check therefore compares the browser's actual target with the synchronization command, rather than assuming frozen CSS geometry. The theater's geometry and animation were preserved.
