# React + Vite

## Playback regression checks

Install dependencies in both `frontend` and `backend`, then run from `frontend`:

```sh
npm test
npm run lint
npm run build
npm run test:browser
```

Run `npm test` from `backend` for Socket.IO integration, controller permissions,
source switching, reconnect, restart, and load tests.

The browser test starts and stops its own frontend/backend on available local
ports. It uses independent host, viewer, and late-join browser sessions with the
bundled video fixture. It checks link controls, scheduled local playback, paused
and playing seeks, drift below 300 ms, late joins, reconnect readiness, replay
after the end, and switching back to a link. It also checks moderator and queue
permissions, kick recovery, invalid saved sessions, and screen-share stability
using a generated canvas stream (no desktop capture). No external video service
is needed.

The test uses installed Chrome/Edge on Windows, or Playwright Chromium elsewhere
(`npx playwright install chromium`). Set `BROWSER_EXECUTABLE` to select another
Chromium executable. Autoplay is enabled for deterministic sync testing; browser
autoplay rejection also has a unit test. This does not replace checks on real
mobile devices, external video providers, or unsupported local codecs.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
