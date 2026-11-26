# Native room protocol

Room/domain protocol remains version **2**. Native WebSocket framing is independently version **1**. `event-map.json` records every original event and its unchanged domain name; `disconnect` is a transport lifecycle callback, not a permitted client event. Socket.IO packets must never be sent to `/ws/rooms/:code`.

1. Browser opens an allowed-Origin connection to a seven-character room object route.
2. First frame: `{ "v": 1, "type": "hello", "accessToken": "optional Supabase JWT" }`. Never put JWTs or resume secrets in URLs. Guest omission is allowed. The server closes sockets without a valid handshake after ten seconds.
3. Server responds `{ "v": 1, "type": "welcome", "id": "server-generated socket ID" }` after account verification. Clients request room creation/join with the existing version-2 payloads. Browser routing codes do not authorize identity or claim a room before the reducer accepts creation.
4. Events use `{ "v": 1, "id": "unique request ID", "seq": 1, "event": "room:join", "args": [{...}], "ack": true }`. Sequence numbers increase on this socket. Only one bounded object payload is accepted. The entire frame must fit 256 KiB.
5. Acknowledgements use `{ "v": 1, "ack": "request ID", "result": {...}, "revision": 1 }`. Normal events use `{ "v": 1, "event": "user_left", "args": ["socket ID", {...}], "revision": 1 }`. Multiple outbound args are preserved for legacy handlers.
6. Replay checks use WebSocket attachment sequences, a bounded persistent recent-ID window and canonical domain command/source sequence checks. A duplicate mutation never broadcasts again. ACK snapshots are reconstructed from the current room rather than persisting a full playlist/queue per socket. This is recovery by authoritative state, not an unlimited exactly-once history.
7. `__watchly_ping__` / `__watchly_pong__` use the platform's auto-response facility. They do not wake room JavaScript. Browser heartbeats are adaptive; clock-offset samples and explicit `network_ping` replies run separately. Server timers are represented by alarms, not Node intervals.
8. The browser discards playback/chat/signaling actions during an outage, reconnects with exponential backoff/jitter, reads its current JWT again, rejoins using private resume credentials and requests an authoritative snapshot. Browser visibility recovery resamples clocks and restores state. A destination-socket switch during initial join waits for that destination's welcome before sending any event.

Socket IDs and account/member IDs are distinct. Socket IDs use 32 hexadecimal characters to preserve the existing signaling validator's maximum length. Persistent member IDs, host permissions and resume-token hashes remain server-owned.

Application WebSockets carry SDP/ICE and room events only. LiveKit/coturn or peer-to-peer WebRTC transport the actual media. No movie/audio/video frame is placed in a room event.
