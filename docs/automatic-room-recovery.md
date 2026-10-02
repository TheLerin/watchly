# Automatic room recovery

## Existing limitations and reused architecture

Watchly already had a singleton Socket.IO client, stable server member UUIDs and hashed resume tokens, room snapshots, server clock sampling, local-file canonical playback, source versions, playlist readiness, and voice renegotiation. Transport reconnection alone did not reliably restore room membership or playback: it stopped after 24 attempts, marked the connection restored before the player recovered, and the saved-session restore discarded the room after 90 seconds. Host players normally skip viewer drift correction, so a host needed explicit restoration too. Old versions from a different source could bypass the previous same-source version check. Empty rooms expired after 30 seconds, preventing a lone participant from recovering a 60-second outage.

The implementation keeps those protocols and the same socket/player integrations. It adds a small recovery coordinator and a temporary player restoration operation, not a second synchronization engine.

## Connection and room recovery

`connected` displays **Synced**, `reconnecting` displays **Reconnecting…**, `resyncing` displays **Resyncing…**, and `offline` displays **Offline**. An outage lasting 20 seconds continues retries with an explanation in the status button. Socket.IO's existing Manager owns jittered exponential transport backoff: approximately 1, 2, 4 and 8 seconds, capped at 8 seconds, with no attempt limit. A room join/snapshot has a 10-second acknowledgement timeout and a single 5-second retry timer. There are no simultaneous join requests or additional sockets. One lost-connection toast and one successful-recovery toast are shown per outage.

The coordinator silently sends existing `room:join` with saved room code, nickname, member UUID, resume token and protocol version. It waits for the acknowledged authoritative snapshot, then restores the player before enabling room commands. `room:snapshot` refreshes an already-bound membership on visible/focus return; these signals are throttled to five seconds and coalesced. Browser online/offline events supplement actual socket state. A generation counter invalidates old acknowledgements, player completions and timers after flapping, leaving, or retrying. Strict Mode effects remove their socket, Manager and browser listeners.

The server resumes the same UUID instead of creating a member. Invalid supplied credentials fail with `SESSION_INVALID`. Resuming over a still-live old socket fences that socket, removes its room binding and reports `SESSION_REPLACED`. Snapshots replace members and queue, merge bounded chat history by message ID, and restore controller, source, playlist, readiness, permissions/roles and canonical playback.

Empty rooms now survive five minutes. The existing controller-disconnect pause and 15-second controller lease/transfer remain intact. Controller recovery restores that paused authoritative state; it does not resume the old local playing state. Temporary rooms remain in memory: a server restart, expiry, kick/ban or other permanent membership error stops recovery and reports the reason. Intentional Leave and navigation out of the room also stop it and clear the saved session.

## Playback restoration

Remote playback reuses the current room clock estimate:

```
expected = playedSeconds + max(0, estimatedServerNow - updatedAt) / 1000  // playing
expected = playedSeconds                                             // paused
```

Local files reuse `canonicalPosition`: the scheduled `effectiveAtServerMs`, sequence number, status and existing synchronized-media clock determine position. Restoration respects a future effective deadline and clamps position to available duration. It waits for native `canplay`/`seeked` readiness or the actual YouTube API/video identity before seeking and restoring play/pause. If loading takes time, it recalculates the advancing target. Readiness is checked every 200 ms as well as native events; correction retries are bounded and rate limited, and a stalled restore fails after 30 seconds. **Sync failed** keeps the room and offers a new snapshot retry. Browser autoplay denial retains the existing user-gesture overlay.

Normal drift correction and scheduled/debounced playback writes are suspended during recovery. Programmatic seek markers, existing local seek suppression, playlist session suppression, and a connection-phase check prevent restoration from emitting user play/pause/seek/navigation commands. Offline room writes are rejected, not queued; the socket's old send buffer is cleared. Voice/screen signaling likewise avoids buffering offline messages.

An additive monotonic `sourceEpoch` fences delayed events across whole source replacements; existing `sourceId`, playlist `sourceRevision` and state versions still fence changes within a source. Local playback messages include their media identity and epoch. A stable local declaration timestamp avoids changing the local session key on rejoin. Existing correct native players, YouTube iframes and local object URLs stay mounted. A full reload truthfully requests the same local file; fingerprint verification/readiness then triggers automatic recovery. File bytes are neither uploaded nor persisted.

## Voice and screen sharing

Voice reconnect reuses a still-live microphone stream and its mute state, closes obsolete peers and runs the existing room-bound voice rejoin/renegotiation path. It never requests a microphone again automatically. WebRTC connectivity remains subject to browser suspension, ended tracks, autoplay policy and STUN/TURN/network availability; a failed or unavailable microphone is reported for manual voice rejoin. Recovery of playback does not wait for voice.

An interrupted screen share stops capture and closes peers, reports the interruption, and requires an explicit **Share Screen** action to restart. No display capture permission dialog is opened by recovery. Async capture/signaling completions are fenced so an interrupted start cannot restart sharing later.

## Changed files

- Server snapshots, identity fencing, source epochs and empty-room grace: `backend/realtime.js`.
- Socket configuration and room coordination: `frontend/src/socket.js`, `frontend/src/context/RoomContext.jsx`, `frontend/src/utils/roomRecovery.js`, `frontend/src/utils/roomState.js`.
- Player restoration and playlist readiness: `frontend/src/components/VideoPlayer.jsx`, `frontend/src/utils/playerResync.js`, `frontend/src/hooks/useYouTubePlaylist.js`, `frontend/src/utils/youtubePlaylistSession.js`.
- Compact status/actions and voice/share interruption: `frontend/src/components/RoomLayout.jsx`, `frontend/src/components/VoiceRoom.jsx`, `frontend/src/components/player/PlaylistControls.jsx`, `frontend/src/components/player/ScreenShareAdapter.jsx`, `frontend/src/hooks/useScreenShare.js`.
- Tests: `backend/test/realtime.integration.test.js`, `frontend/test/roomRecovery.test.js`, `frontend/test/playerResync.test.js`, `frontend/test/browserRecovery.cjs`, `frontend/test/browserRecoveryMedia.cjs`, `frontend/test/browserPlaylist.cjs`.

## Verification

Passed: 70 frontend tests, 29 backend tests, ESLint, production build, the complete recovery browser suite with the default 60-second outage, the genuine YouTube playlist/single-video browser suite, and the existing playback/layout browser regression. These suites finished without browser JavaScript errors.

Unit/integration suites cover retry coalescing, bounded retries, stale ACK/completion cancellation, permanent errors, failed-player retry, epoch fencing, overlapping socket identities, invalid credentials, chat reconciliation, metadata/seek readiness, buffering, local canonical deadlines and YouTube paused restoration.

`browserRecovery.cjs` uses genuine Chrome network-offline contexts and actual HTML video, with five-second and 60-second outages, offline source changes and pause/seek changes, retained queue/chat, repeated flapping, member/listener counts, cleared buffered commands, fresh foreground snapshots, retained local blob/player, mobile local recovery/reselection after reload, explicit leave and server restart. Capture streams are synthetic, while voice peer negotiation and socket transport are real; the test checks no extra capture requests, retained mute and stopped screen tracks.

`browserPlaylist.cjs` uses the genuine YouTube iframe API for discovery, full playlist completion, controls, late joins/refresh, offline item changes, restored readiness, retained iframe, single-video paused recovery, mobile and Cinema Luxe. `browserPlayback.cjs` exercises existing direct/local playback, seeks, queue, moderation, chat, subtitles, appearance/responsive layouts and screen sharing. Real phone OS suspension and production TURN routing are not simulated by the desktop browser harness.

Run browser suites sequentially so the short media fixture and genuine YouTube loading are not affected by concurrent browser load. Default long outage is 60 seconds; `RECOVERY_LONG_OUTAGE_MS` can shorten an iteration, and the test output prints the duration used.
