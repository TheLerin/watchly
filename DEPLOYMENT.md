# Watchly deployment and release validation

Watchly uses a Vercel static frontend and a Render Socket.IO backend. Rooms are intentionally temporary and disappear when the backend restarts or deploys. Local File Sync never uploads movie bytes; each browser plays its own selected file.

## 1. Deploy the backend to Render

Create a Render Blueprint from `render.yaml`. Configure these secret/environment values on the service:

- `CORS_ORIGIN`: the exact Vercel HTTPS origin. Multiple intentional origins may be comma-separated.
- `TURN_URLS`: comma-separated TURN/TURNS endpoints, for example `turn:turn.example:3478?transport=udp,turns:turn.example:443?transport=tcp`.
- `TURN_SHARED_SECRET`: the coturn REST API shared secret. Never expose it in Vercel or frontend source.
- `TURN_USERNAME_PREFIX`: optional account prefix; defaults to `watchly`.
- `TURN_TTL_SECONDS`: credential lifetime from 300–86400 seconds; defaults to `3600`.

Before deploying, run:

```sh
NODE_ENV=production CORS_ORIGIN=https://watchly.example TURN_URLS='turns:turn.example:443?transport=tcp' TURN_SHARED_SECRET='replace-me' npm --prefix backend run preflight
```

After deploy, open `https://YOUR-RENDER-SERVICE/api/health`. It must report `ok: true`, `protocolVersion: 2`, and `turnReady: true`. The active room count is in-memory operational data, not persistence.

## 2. Deploy the frontend to Vercel

Import the repository and use:

- Root directory: `frontend`
- Framework preset: Vite
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variable: `VITE_BACKEND_URL=https://YOUR-RENDER-SERVICE`

Redeploy the backend after setting the final Vercel origin in `CORS_ORIGIN`. `frontend/vercel.json` preserves direct `/room/ROOM123` navigation.

## 3. Release acceptance

Use four independent devices or browser profiles and one identical MP4 H.264/AAC fixture, including a renamed copy. Record results and browser versions.

1. Create a room, open its shared URL in three clean sessions, and confirm nickname onboarding occurs on the room URL.
2. Confirm a mistyped code returns “room not found” and never creates a Host room.
3. Select **Watch Local File** as controller, choose a private display title, then select matching copies on all viewers.
4. Confirm a renamed identical copy becomes ready; a different file shows `MISMATCH`; an unsupported codec shows `UNSUPPORTED`.
5. In browser network tools, confirm no movie request or Socket.IO binary/chunk payload is sent for Local File Sync.
6. Exercise play, pause, paused seek, playing seek, late join, refresh/reselect, socket reconnect, background/foreground, buffering recovery, and the autoplay click overlay.
7. Measure 20 trials. Target 95% play/pause skew at or below 250 ms; steady drift at or below 250 ms on desktop and 500 ms cross-browser/mobile; reconnect recovery within two seconds.
8. Disconnect the controller for less than 15 seconds and confirm its lease resumes. Disconnect beyond 15 seconds and confirm exactly one Moderator or longest-connected Viewer takes control.
9. Restart Render and confirm the old URL reports that the temporary room expired and offers creation of a new room.

## 4. TURN-relay acceptance for Screen Share Beta

Use two devices on different networks. In a development build, set `VITE_FORCE_RELAY=true`, then start voice and **Share Screen (Beta)**. Confirm the peer status reports relay, shared audio status is clear, one sharer plus three viewers is enforced, voice remains active while sharing starts/stops, and no media frames pass through Render logs or Socket.IO traffic.

If `turnReady` is false or relay-only connection fails, Local File Sync remains production-ready but Screen Share Beta must remain labeled beta and must not be advertised as universally available.

## 5. Routine verification

```sh
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```
