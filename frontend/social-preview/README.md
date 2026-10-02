# Watchly social preview

`../public/og/watchly-room-v2.png` is the shared 1200 × 630 Open Graph and Twitter
card (about 257 KiB). Public URL: **https://wchly.vercel.app/og/watchly-room-v2.png**.
One image serves the homepage and every room. Its deterministic versioned filename
allows a future refresh without random per-request cache-busting.

The editable composition is `watchly.html`. It uses the existing `../public/logo.png`
and the unchanged user-provided screenshot in `assets/watchly-room.png`. The screenshot
is proportionally scaled and intentionally cropped: peripheral side toolbars and
the lower sofa foreground are secondary; the complete player, bezel, wall slivers,
platform and top navbar remain. No interface, content, users, logo or chat are generated.
Branding and the player fit inside the central 630-pixel square for common centered
thumbnail crops. Very small thumbnails may make supporting text unreadable; platform
crops vary. The background stays #050505 and the font remains Watchly's DM Sans.

To regenerate from the `frontend` directory:

```sh
node social-preview/render.cjs
```

The renderer uses Playwright and installed Chrome or Edge. Set `BROWSER_EXECUTABLE` to use another Chromium executable. The layout loads DM Sans from Google Fonts and fails if the font or either image cannot load, rather than silently exporting an incomplete card.

Older preview images remain available for existing cached links.

## Metadata and architecture

The app is React 19 + Vite 7, with React Router's BrowserRouter and a client-rendered
`/room/:roomId` route. Previously all paths received static `index.html` metadata.
Favicon/apple icon remain `public/logo.png`; no app head library or framework migration.

| Page | HTML / OG / X title | HTML / OG / X description |
| --- | --- | --- |
| Homepage | Watchly — Watch Together | Watch videos together in perfect sync. |
| Room | Join my Watchly room | Watch together in perfect sync. |

`index.html` holds the homepage tags. A narrow Vercel rewrite sends `/room/:roomCode`
to `api/room-preview.js`, ahead of the existing SPA fallback. The function reads
the same deployment's built `dist/index.html`, explicitly bundled using
`functions.includeFiles`, and replaces only title, descriptions, canonical and
OG/X URL tags through `metadata.js`. Vite's app root, hashed JS/CSS and PWA tags are
preserved; room deep links still boot the existing application. Browsers and crawlers
receive the same shell. No socket backend or room-state lookup. GET and HEAD work.
Room codes are URL-encoded; no host, participant count, movie, password or activity
is exposed. Canonical URLs use the production origin and shared room path, without
query parameters.

Vercel project root remains `frontend`, build command `npm run build`, output `dist`.
The [Vercel file bundling guide](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)
documents `process.cwd()` and `includeFiles`. The
[Vite SPA guide](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas)
documents the retained fallback.

The frontend remains an SPA. The Vercel function supplies the head on direct room
requests; `vite dev` / `vite preview` and other static-only hosts do not execute it.
Client navigation does not fetch a new document head. Crawlers fetch shared links
directly, so their metadata does not depend on JavaScript. This is metadata-only
server rendering, not a room/UI render or a per-room image.

## Validation

From `frontend`:

```sh
node node_modules/vite/bin/vite.js build
node --test test/socialMetadata.test.js
node test/socialPreview.cjs
```

The smoke test uses the production handler and built shell, verifies requested tags
at `/`, `/room/test123` and `/room/LAT3BIQ`, compares the unchanged SPA body, fetches
hashed assets, checks HEAD, opens the room join screen in Chromium and exports a
central square crop. It emulates the Vercel rewrite locally; live HTTPS is the final check.

After deployment:

```powershell
$env:PUBLIC_BASE_URL = 'https://wchly.vercel.app'
node test/socialPreview.cjs
Remove-Item Env:PUBLIC_BASE_URL
```

This fetches raw HTML as a social crawler without JavaScript and checks the public
HTTPS image response, MIME type and PNG dimensions. Also open a room URL directly
to check app loading. Use Facebook Sharing Debugger to request a fresh scrape, then
share homepage and room links in WhatsApp / X. Platforms may retain old titles or
thumbnails; the v2 image URL refreshes the image identity but cannot force all caches.
