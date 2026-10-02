# Synchronized YouTube playlists

Watchly accepts playlist URLs in its existing Watch input. A playlist loads paused, and Play Now becomes available only when the existing YouTube iframe reports the selected item as CUED. The compact controls show the actual current title when available, position, readiness, Previous, Play/Pause and Next. The existing Up Next panel displays the playlist separately from the Watchly room queue.

## Source parsing and room state

`frontend/src/utils/youtubeUrl.js` parses YouTube, shortened and embed URLs with URL/URLSearchParams. It preserves `list`, selected video and valid `index`. URL indexes are one-based; room indexes are zero-based. The server independently validates the playlist URL in `backend/youtubePlaylist.js`. After discovering the ordered list, a requested video takes precedence over the index; a matching duplicate at the requested index is preserved. An invalid out-of-range index falls back to the first item.

Playlist state extends the existing `videoState` rather than adding a playback store:

- `sourceType: 'youtube-playlist'`, `playlistId`, `requestedVideoId`
- `playlistItems`, `playlistIndex`, `currentVideoId`, `playlistTitles`
- `playlistStatus: 'loading' | 'ready' | 'finished' | 'error'`
- `sourceRevision`, `unavailableIndexes`, `resumeAfterResolve`

It retains `sourceId`, `playedSeconds`, `isPlaying`, `updatedAt`, `seekVersion` and `stateVersion`. Playback rate stays at the existing default. Metadata titles are bounded to 200 entries. Periodic progress snapshots omit the manifest/title map, which clients retain; source changes and item transitions send the full snapshot.

## One player, authoritative navigation

`useYouTubePlaylist` and `youtubePlaylistSession` use `ReactPlayer.getInternalPlayer()` to access the existing YT.Player. The controller calls official `cuePlaylist` and reads `getPlaylist()` once to discover the ordered list, then submits it to the server. The current item is cued with `cueVideoById` on that same iframe. This clears the native YouTube playlist, preventing viewers from independently auto-advancing. Full playlist identity and order remain in the room state. No additional iframe, Data API key, extraction or media proxy is introduced. API behavior follows the [official IFrame API reference](https://developers.google.com/youtube/iframe_api_reference), with native playlist clearing and readiness verified in Chrome against the real embed.

ReactPlayer 2.16 supplies `videoId: null` for playlist URLs, which the current IFrame API rejects. Its existing `embedOptions.videoId` configuration supplies the selected ID or an empty string to initialize playlist sources successfully, without modifying the dependency or overriding its event handlers.

Only the room's current controller can resolve or navigate a playlist. Each member acknowledges READY after the expected video is genuinely CUED and its native playlist has been cleared. Play requires the controller's readiness. Next preserves play intent; Previous restarts the current item after five seconds, otherwise selects the prior available item. The controller's ENDED event advances exactly one item; viewers wait for the authoritative transition. The final item stops, or starts the next existing Watchly queue source. Queued playlists retain the queue's play intent after discovery. Looping and shuffle are off.

Existing play/pause, seek, progress interval, clock adjustment and viewer drift correction continue to synchronize playback. Late joins and reconnects receive the current manifest, item identity, position and play intent in the normal room snapshot, cue that item at the expected position, then apply the existing synchronization correction. Refreshing a completed playlist cues its final item without restarting playback.

## Stale events and failures

Playlist controls and playback messages carry `sourceId`, `sourceRevision`, `playlistId`, `playlistIndex` and `currentVideoId`. The server requires an exact current-item match. Old playlist messages also cannot modify a replacement single-video source. Source changes cancel pending play/pause debounce callbacks. Programmatic cue events are suppressed for 600ms, and progress/user callbacks require the expected ready item. Duplicate ENDED/navigation messages are rejected after the revision changes, preventing double-next and socket feedback.

Only the controller reports an item failure to navigate forward. Known failed indexes are skipped without wrapping; attempts are bounded by the returned list. Discovery times out after 15 seconds, API initialization after 20 seconds, and an item that never becomes CUED after 15 seconds. Item timeouts can skip even when YouTube still exposes old-item metadata. A viewer failure cannot prevent a newly assigned controller from advancing. Failed acknowledgements can retry while the item identity remains current. Friendly notices replace raw API errors.

YouTube may omit private/deleted items from `getPlaylist()` and restrict playback by account, region or embedding policy. Watchly uses the complete list exposed by the official iframe API; it does not recover hidden IDs or bypass restrictions. Titles for future items fall back to numbered labels until their API metadata becomes available. Normal browser autoplay policies still apply.

## Files and verification

Backend: `realtime.js`, new `youtubePlaylist.js` and `test/youtubePlaylist.integration.test.js`.

Frontend: `VideoPlayer.jsx`, `UserQueueSidebar.jsx`, `RoomContext.jsx`, `utils/videoSources.js`; new `utils/youtubeUrl.js`, `utils/youtubePlaylistSession.js`, `hooks/useYouTubePlaylist.js`, `components/player/PlaylistControls.jsx`, `test/youtubePlaylist.test.js` and `test/browserPlaylist.cjs`.

Run frontend unit tests with `node --test test/*.test.js`, backend tests with `node --test`, lint with `node node_modules/eslint/bin/eslint.js .`, and production build with `node node_modules/vite/bin/vite.js build`. The real Chrome/YouTube test is `node test/browserPlaylist.cjs`; it creates isolated test servers and exercises Google's public Search Stories playlist.

The live test covers paused genuine readiness, Next/Previous, seek/play/pause, automatic completion of all ten exposed items, final stopped refresh, selected-video URL precedence, late join/refresh at the active item/time, mobile and Cinema Luxe controls, one iframe, switching back to normal shortened YouTube links, and no JavaScript page errors. Server tests cover full completion, unavailable-item exhaustion, queue handoff, controller authority, readiness gating, stale/duplicate messages and reconnect restoration. Existing `test/browserPlayback.cjs` covers direct video, local files, synchronized seeking, subtitles, queue, control transfer, chat and existing appearance/responsive behavior.

Verified on October 2, 2026: 56 frontend tests, 27 backend tests, lint, production build, full existing browser regression and real YouTube playlist browser test pass. Unavailable-item cases and controller transfer are covered by deterministic session/server tests; actual playback and every exposed item's completion use genuine YouTube events.
