# WatchSync — Full Codebase Audit Report

> Audited: `backend/server.js`, `backend/gdrive-trace.js`, `frontend/src/socket.js`,  
> `frontend/src/App.jsx`, `frontend/src/context/RoomContext.jsx`,  
> `frontend/src/components/RoomLayout.jsx`, `frontend/src/components/VideoPlayer.jsx`,  
> `frontend/src/components/ChatUI.jsx`, `frontend/src/components/UserQueueSidebar.jsx`,  
> `frontend/src/index.css`

---

## 1. Issues Found

### 🔴 BUGS (Can cause incorrect behaviour)

| # | File | Issue |
|---|------|-------|
| B1 | `server.js:388` | `kick_user` emits `user_kicked` to the **socket ID** (`targetId`), not the **user** — if the target already reconnected with a new socket ID, the kick never arrives |
| B2 | `server.js:392` | `io.to(roomId).emit('user_left', targetId)` sends the **socket ID** as the userId; but in `RoomContext` `onUserLeft` filters by `u.id`, which is the socket ID — this is consistent *now*, but will silently break if the server ever switches to stable `userId`-based IDs |
| B3 | `server.js:532` | `role_updated` after auto-promote sends `userId: nextHost.id` which is the **socket ID**, not the `userId` field. The client's `onRoleUpdated` compares `u.id` (socket ID), so it works — but the naming mismatch is a latent bug |
| B4 | `server.js:270-271` | Express 5 uses promise-based routing. Throwing inside `async` route handlers is caught automatically, BUT the global error handler is registered *after* the async route — this is fine in Express 4 but in Express 5 the middleware order still matters for sync errors; low risk but worth noting |
| B5 | `RoomContext.jsx:30` | `videoStateRef` is kept in sync via a `useEffect`. Between a state update and the effect running, the ref lags one render — any synchronous read of the ref immediately after `setVideoState` sees stale data |
| B6 | `RoomContext.jsx:290` | `pauseVideo` guards on `videoStateRef.current?.isPlaying` but the ref may be stale (see B5). A rapid play→pause→play can slip through the guard and emit an extra event |
| B7 | `VideoPlayer.jsx:606` | `const wasReady = isPlayerReady` captures the **React state** value — stale inside the event callback. If `onCanPlay` fires twice quickly, the inner `play()` call runs twice |
| B8 | `VideoPlayer.jsx:675-679` | For the host using ReactPlayer, `onSeek` calls both `startSeekGuard()` and `endSeekGuard()` back-to-back synchronously. `endSeekGuard` immediately clears `isSeekingRef`, meaning the 300ms `seekVideo` timer fires even if the user is still dragging the seekbar (only affects multi-seek in quick succession) |
| B9 | `server.js:130-251` | All three `startUrls` share the same `res` object. If strategy A partially writes headers before failing (unlikely but possible if `streamResponse` is called and the stream errors mid-pipe), strategies B and C will try to write to an already-sent response |
| B10 | `gdrive-trace.js:54-83` | Redundant `if (ct.includes('text/html'))` block at line 54 — the condition at line 48 already asserts `!ct.includes('text/html')` and breaks out; the second `if (ct.includes('text/html'))` at line 54 is therefore always true at that point, making it dead code disguised as a branch |

---

### 🟡 PERFORMANCE / EFFICIENCY

| # | File | Issue |
|---|------|-------|
| P1 | `server.js:38-39` | `gdriveCache` never evicts stale entries proactively. With 1-hour TTL and many unique file IDs, the Map grows unbounded in long-running processes |
| P2 | `RoomContext.jsx:52-55` | `onUserJoined` calls `prev.some(...)` on every join. Fine for small rooms; no concern for this app size |
| P3 | `VideoPlayer.jsx:341-355` | Sync interval is created/destroyed whenever `isPrivileged`, `syncProgress`, or `isGDriveProxy` changes. `syncProgress` is re-created via `useCallback` only when `roomId` changes — so the interval is stable in practice, but if `roomId` ever changes mid-session the interval restarts correctly |
| P4 | `RoomContext.jsx:86-94` | `addSystemMessage` is defined inside `useEffect` — it's recreated each time the outer effect runs (only once, so this is fine, but it could be extracted to a `useCallback` for clarity) |
| P5 | `VideoPlayer.jsx:371-407` | `debouncePlay`, `debouncePause`, `startSeekGuard`, `endSeekGuard` are plain functions defined in the component body — they are recreated every render. Since they only use refs (not state), wrapping them in `useCallback` with empty deps would make this explicit and prevent any future stale-closure bugs if props are added |
| P6 | `server.js:88-91` | `readBodyText` allocates a `Buffer.from(c)` for every chunk — this is correct but slightly wasteful if chunks are already `Buffer` instances (they usually are in Node.js streams). Checking `Buffer.isBuffer(c)` before wrapping is a minor optimisation |

---

### 🟠 SECURITY

| # | File | Issue |
|---|------|-------|
| S1 | `server.js:43` | `Access-Control-Allow-Origin: *` on the GDrive proxy allows **any** website to proxy through your backend and consume your server bandwidth. Consider restricting to `FRONTEND_URL` |
| S2 | `server.js:10` | Express CORS is locked to `FRONTEND_URL`, but the GDrive proxy route overrides this with `*` (lines 43, 62). Inconsistent — should be unified |
| S3 | `server.js:334-340` | Chat rate-limit (500ms) is per-socket, not per-user. A user with multiple tabs/connections could bypass it. Use `userId` as the key instead |
| S4 | `server.js:407-416` | `change_video` doesn't validate or sanitize the `url` parameter. A bad actor with Host/Mod role could inject arbitrary URLs that the server then broadcasts. Consider basic URL validation (e.g. must start with `http://` or `https://`) |
| S5 | `backend/package.json:16` | `"express": "^5.2.1"` — Express 5 is still in release-candidate phase. For a production deployment, pinning to Express 4 LTS (`^4.21.2`) is safer |
| S6 | `server.js` | No request-size limit on any route — an attacker could send a huge body to a socket event. Socket.IO has a default `maxHttpBufferSize` of 1 MB, but it should be set explicitly |

---

### 🔵 CODE QUALITY / DEAD CODE

| # | File | Issue |
|---|------|-------|
| Q1 | `frontend/src/torrentClient.js` | File exists but is **never imported anywhere** in the codebase — pure dead code |
| Q2 | `backend/gdrive-trace.js` | Diagnostic/debug script — fine to keep but should not be deployed to production (no harm, just noise) |
| Q3 | `backend/test-proxy-logic.js`, `backend/test-proxy.js`, `backend/test-gdrive-html.js` | Test/debug scripts — same as above |
| Q4 | `backend/log.json`, `backend/test-out.txt`, `backend/gdrive-html-dump.html` | Stale debug output files committed to the repo |
| Q5 | `VideoPlayer.jsx:619` | `onTimeUpdate` handler is an empty comment: `{/* host sync handled by interval in effect #6 */}` — the attribute could simply be omitted |
| Q6 | `RoomContext.jsx:1` | `/* eslint-disable react-refresh/only-export-components */` suppresses a lint rule globally for the file. The correct fix is to move the `useRoom` hook export to a separate file, or keep the suppression but scope it narrowly |
| Q7 | `server.js:124-128` | `startUrls[0]` and `startUrls[1]` are nearly identical (same base URL, slightly different param order). The second one adds `authuser=0` which Google ignores for public files. Consolidating to one reduces retry noise |
| Q8 | `UserQueueSidebar.jsx:1` | `useEffect` is imported but only used for the click-outside handler — fine, but worth noting the import includes it alongside `useState` |
| Q9 | `RoomLayout.jsx:5` | `Monitor` icon imported from `lucide-react` and used only in the settings menu — but `GripHorizontal` and `Menu` are also imported and only used in mobile portrait mode. All imports are actually used; this is just a large import list |
| Q10 | `gdrive-trace.js:54` | Dead `if (ct.includes('text/html'))` branch (always true at that point — see B10). The `break` on line 86 is only reached if neither `formMatch` nor `confirmMatch` exist, which is the same path as the else branch in the server's logic |

---

## 2. Cleaned / Fixed Code

### Fix B1 — `server.js`: Kick by userId, not socket ID

**Problem:** `io.to(targetId).emit('user_kicked')` uses the socket ID as the room target, which changes on reconnect.

```diff
- io.to(targetId).emit('user_kicked');
+ const targetSocket = io.sockets.sockets.get(targetId);
+ if (targetSocket) targetSocket.emit('user_kicked');
```

> Note: The code already does `io.sockets.sockets.get(targetId)` a few lines later for `targetSocket.leave(roomId)` — the kick emit should use that same socket reference, not `io.to(targetId)`.

**Fixed block (lines 383–400):**
```js
if (canKick) {
    rooms[roomId].kickedUserIds.add(target.userId);
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
        targetSocket.emit('user_kicked');
        targetSocket.leave(roomId);
        targetSocket.roomId = null;
    }
    rooms[roomId].users = rooms[roomId].users.filter(u => u.id !== targetId);
    io.to(roomId).emit('user_left', targetId);
    if (rooms[roomId].users.length === 0) {
        delete rooms[roomId];
    }
}
```

---

### Fix S1/S2 — `server.js`: Unify CORS on GDrive proxy

```diff
- res.setHeader('Access-Control-Allow-Origin', '*');
+ res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
```

Apply to both the OPTIONS handler (line 43) and `setCorsHeaders` (line 62).

---

### Fix S3 — `server.js`: Rate-limit by userId

```diff
- let lastMessageTime = 0;
- socket.on('send_message', ({ roomId, message }) => {
-     const now = Date.now();
-     if (now - lastMessageTime < 500) return;
-     lastMessageTime = now;

+ const messageRateMap = new Map(); // userId -> lastMessageTime
+ socket.on('send_message', ({ roomId, message }) => {
+     const now = Date.now();
+     const key = socket.userId || socket.id;
+     if (now - (messageRateMap.get(key) || 0) < 500) return;
+     messageRateMap.set(key, now);
```

---

### Fix S4 — `server.js`: Basic URL validation for `change_video`

```diff
socket.on('change_video', ({ roomId, url, magnetURI }) => {
    const sender = getUserInRoom(socket.id, roomId);
    if (sender && (sender.role === 'Host' || sender.role === 'Moderator')) {
        if (rooms[roomId]) {
+           // Reject non-HTTP URLs (magnet URIs are allowed via magnetURI field)
+           if (url && !/^https?:\/\//i.test(url)) return;
            const newState = { ... };
```

---

### Fix P1 — `server.js`: Periodic GDrive cache eviction

Add after the cache declaration:
```js
// Evict expired GDrive cache entries every 30 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of gdriveCache) {
        if (now - val.timestamp >= CACHE_TTL_MS) gdriveCache.delete(key);
    }
}, 30 * 60 * 1000);
```

---

### Fix Q1 — Remove dead `torrentClient.js`

The file `frontend/src/torrentClient.js` is never imported. It should be deleted or moved to a `_unused/` folder if it's planned for the future.

---

### Fix B10 / Q10 — `gdrive-trace.js`: Remove dead HTML branch

```diff
  const ct = r.headers['content-type'] || '';
  if (!ct.includes('text/html')) {
      console.log('\n✅ SUCCESS — Got actual file. Content-Length:', r.headers['content-length']);
      r.data.destroy();
      break;
  }

- if (ct.includes('text/html')) {   // ← always true here; the condition is redundant
+ // At this point ct always includes 'text/html'
  const chunks = [];
  ...
  break;
- }
- break;  // ← unreachable
```

---

### Fix P5 — `VideoPlayer.jsx`: Stabilise helper functions with `useCallback`

```diff
- const debouncePlay = () => { ... };
- const debouncePause = (getTime) => { ... };
- const startSeekGuard = () => { ... };
- const endSeekGuard = (getTime) => { ... };

+ const debouncePlay = useCallback(() => { ... }, [playVideo]);
+ const debouncePause = useCallback((getTime) => { ... }, [pauseVideo]);
+ const startSeekGuard = useCallback(() => { ... }, []);
+ const endSeekGuard = useCallback((getTime) => { ... }, [seekVideo]);
```

These functions only read refs and call stable callbacks, so the deps arrays are minimal.

---

### Fix Q4 — `.gitignore` additions

Add to `.gitignore`:
```
backend/log.json
backend/test-out.txt
backend/gdrive-html-dump.html
backend/gdrive-trace.js
backend/test-*.js
```

---

## 3. Explanation of Key Changes

| Fix | Why it matters |
|-----|---------------|
| **B1 – kick via socket ref** | Using `io.to(socketId)` works when the socketId is current, but fetching the actual `Socket` object and calling `.emit()` directly is more explicit and eliminates ambiguity. The existing code already fetches the socket two lines later — consolidating removes redundancy. |
| **S1/S2 – unify CORS** | Serving `Access-Control-Allow-Origin: *` on the proxy opens it to abuse from any origin. Locking it to `FRONTEND_URL` is a one-line change with no functional downside for legitimate users. |
| **S3 – userId rate limit** | Multi-tab users share the same `userId` but have different sockets. Rate-limiting by `socket.id` means each tab gets its own 500ms bucket — effectively doubling the allowed rate per user per extra tab. |
| **S4 – URL sanitisation** | The `url` field is broadcast to all clients and also stored in server state. A Host/Mod could accidentally (or maliciously) inject `javascript:...` or `data:` URIs. A simple regex guard costs nothing. |
| **P1 – cache eviction** | Without eviction, the `gdriveCache` Map will grow forever in a long-running server process if many unique file IDs are proxied. A 30-minute cleanup sweep is sufficient for a 1-hour TTL. |
| **B10 – dead branch** | The `if (ct.includes('text/html'))` at line 54 of `gdrive-trace.js` is always true (the `!ct.includes` branch above it breaks on success). The dead `break` at line 86 is therefore unreachable. Removing it makes the control flow clear. |
| **P5 – useCallback helpers** | Recreating arrow functions every render is harmless in isolation, but because `debouncePlay`/`debouncePause` are referenced inside event handlers registered in JSX, they create subtle closure-staleness risks if the component grows. Stabilising them now prevents future bugs. |

---

## 4. Optimization Suggestions

### Architecture

1. **Split RoomContext into smaller contexts** — The context currently manages: connection state, user list, chat messages, video state, and queue. This means any of these changing causes every consumer to re-render. Split into `ConnectionContext`, `VideoContext`, and `ChatContext` to reduce render scope.

2. **Move socket event registration to a custom hook** — The giant `useEffect` in `RoomContext` (lines 35–164) with 14 event listeners is hard to maintain. Extract each event group into a small dedicated hook (`useVideoSync`, `useRoomUsers`, `useChat`).

3. **Persist chat history on the server** — Currently `chatHistory: []` is always sent on `room_joined`. New joiners see an empty chat even if 200 messages have been sent. A simple circular buffer (last 100 messages) on the server would fix this.

4. **Add a `nodemon` dev script** — `backend/package.json` only has a `start` script. Add `"dev": "nodemon server.js"` for development restarts on file change.

5. **Add `.env.example` to the frontend** — The backend has `.env.example`, but the frontend's `VITE_BACKEND_URL` variable is undocumented.

### Performance

6. **Throttle `sync_progress` on the host** — Currently the host emits every 2000ms via a `setInterval`. If the host pauses the video, `sync_progress` still fires with the same timestamp. Guard with: `if (lastEmittedTime === t) return;` inside the interval.

7. **Use `requestAnimationFrame` for GDrive native player time updates** — Instead of the 2-second interval reading `nativeVideoRef.current.currentTime`, an `rAF` loop would be smoother and more accurate for the host's progress sync. However, this would increase network traffic — keep the 2s interval but emit only on actual change.

8. **Debounce `orientationchange` in `useOrientation`** — The handler fires multiple times during a rotation. A 100ms debounce on the resize/orientation handler would prevent unnecessary state updates in `RoomLayout`.

### Code Quality

9. **Remove or gate debug `console.log` statements** — `server.js` has many `console.log` calls that run in production. Gate them behind a `DEBUG` environment variable or use a lightweight logger like `pino`.

10. **Extract URL-type detection logic** — `isYouTube`, `isGDriveProxy`, `isArchive` are computed from the URL string via inline `!!(...)` expressions in `VideoPlayer`. Extract these to a `detectVideoSource(url)` utility function that returns a type enum — easier to test and extend.

11. **Add PropTypes or TypeScript** — Functions like `handleLoad`, `handleQueueAdd`, and `resolveArchiveUrl` have no type annotations. A simple JSDoc or PropTypes addition would prevent accidental misuse. Full TypeScript migration would be the ideal long-term improvement.

---

## 5. Risk / Warning

> [!WARNING]
> **Express 5 in production** (`"express": "^5.2.1"`). Express 5 is not yet officially stable. It changed how async errors propagate and how routing works. If you ever upgrade Express patch versions and something breaks silently, this is the first place to look. Pin to `"4.21.2"` for a production deployment.

> [!WARNING]
> **GDrive proxy is unauthenticated and open** — any client that knows your backend URL can call `/api/proxy/gdrive?id=<any_id>` directly, bypassing your frontend entirely. Consider adding a shared secret header or rate-limiting by IP (e.g. with `express-rate-limit`) to prevent bandwidth abuse.

> [!WARNING]
> **In-memory `rooms` store** — if the server restarts, all room state is lost and users will be unable to reconnect (they'll be redirected to `/` after the 6-second timeout). This is expected for a hobby project but would need a Redis or database backend for production.

> [!CAUTION]
> **`sessionStorage` persistence** — the session is stored in `sessionStorage`, which is cleared when the browser tab is closed. If a Host closes their tab, they reconnect as a Host on the same `userId` due to the logic in `joinRoom`. However, if the tab is closed for longer than the server's room cleanup window, the room is deleted and the userId is no longer in the `kickedUserIds` set — a previously kicked user could rejoin after a server restart. Acceptable for a hobby app, but a known gap.

> [!NOTE]
> **`gdrive-trace.js` and `test-*.js`** — these are debug/diagnostic scripts. They are harmless but should not be part of a production Docker image or deployment. Add them to `.gitignore` or a dedicated `scripts/debug/` folder with a README explaining their purpose.

---

## Code Interaction Trace

```
User opens /room/:roomId
  └─ RoomLayout mounts
       ├─ Reads isRestoringSession → shows spinner
       ├─ useEffect: socket.connect() (if session in sessionStorage)
       │     └─ socket.emit('join_room')
       │           └─ server: creates/updates room, emits 'room_joined'
       │                 └─ RoomContext: onRoomJoined → sets currentUser, users, videoState, queue
       └─ Renders VideoPlayer (NEVER unmounted — stable DOM path)

Host loads a video
  └─ VideoPlayer.handleLoad()
       ├─ resolveArchiveUrl() if archive.org/details
       └─ RoomContext.loadVideo(url)
             ├─ setVideoState(newState)  [local optimistic update]
             └─ socket.emit('change_video')
                   └─ server: validates role, sets rooms[id].videoState, emits 'video_changed'
                         └─ All clients: RoomContext.onVideoChanged → setVideoState
                               └─ VideoPlayer: useEffect [url change] resets player state
                                     └─ ReactPlayer/native <video> remounts (key=playerUrl)

Host plays/pauses
  └─ VideoPlayer: browser fires onPlay/onPause
       └─ debouncePlay / debouncePause (200ms)
             └─ RoomContext.playVideo / pauseVideo
                   ├─ Guard: check videoStateRef.current.isPlaying to prevent loops
                   ├─ setVideoState locally
                   └─ socket.emit('play_video' | 'pause_video')
                         └─ server: socket.to(room) → viewers only
                               └─ Viewers: onVideoPlayed/onVideoPaused → setVideoState
                                     └─ VideoPlayer: effect #4 controls native video play/pause

Host seeks
  └─ VideoPlayer: browser fires onSeeking → startSeekGuard (blocks play/pause debounces)
       └─ onSeeked → endSeekGuard → (300ms) → seekVideo(t)
             └─ RoomContext.seekVideo
                   ├─ Increments seekVersion
                   └─ socket.emit('seek_video')
                         └─ server: increments seekVersion, emits 'video_seeked'
                               └─ Viewers: onVideoSeeked → increments seekVersion
                                     └─ VideoPlayer: drift-correction effects fire (isForcedSeek=true)
                                           └─ ReactPlayer.seekTo / nativeVideo.currentTime = t

Host sync interval (every 2s)
  └─ VideoPlayer: setInterval → syncProgress(currentTime)
       └─ socket.emit('sync_progress')
             └─ server: updates playedSeconds, emits 'video_progress' to viewers only
                   └─ Viewers: onVideoProgress → setVideoState(playedSeconds)
                         └─ VideoPlayer: drift-correction checks abs(drift) > DRIFT_THRESHOLD (2s)
                               └─ If drift > 2s: seekTo / adjust playbackRate
```

---

*Report generated: 2026-04-25*
