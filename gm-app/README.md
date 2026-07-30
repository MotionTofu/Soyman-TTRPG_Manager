# RPG Manager — GM (mobile companion)

**Мобил-мастер**: a Capacitor mobile app (`android/`) wrapping `client/`, a
thin React app that talks to a hosted server (`../server`, `AUTH_ENABLED=true`)
over HTTPS + WebSocket. Not a full replacement for мастер-клиент (the desktop
GM app) — a session-prep companion: browse notes/playlists/bestiary/compendium
mid-session and push a "показать изображение" broadcast to connected players.

## Architecture

- Same dual-bridge pattern as `../player-app`: an Electron main process
  (`electron/main.js`) for desktop dev/testing, and a fetch-based
  `client/src/webBridge.ts` for the Capacitor WebView (no Electron main
  process on mobile). `client/src/main.tsx` installs the web bridge whenever
  `window.gmApp` is absent.
- Unlike игрок-клиент's named per-endpoint bridge methods, gm-app exposes a
  **generic** `apiGet<T>(path)` / `apiPost<T>(path, body)` pass-through with a
  flat path-keyed cache. Chosen because мобил-мастер needs mostly-read access
  across many different data shapes (campaigns, sessions, playlists,
  statblocks, compendium, resources) rather than player-app's few
  well-defined writes — adding a named method per endpoint would just be
  boilerplate here.
- `connect` validates the logged-in account has `role === "gm"` and rejects
  player accounts with a Russian error message before ever reaching the
  dashboard.
- Media (thumbnails, audio playback) served from `/files/*` needs a Bearer
  auth header, which `<img>`/`<audio> src` can't send — every such element
  is fed via `fetch(url, {headers}) → blob() → URL.createObjectURL(blob)`
  instead of a direct `src`, with `URL.revokeObjectURL` cleanup on unmount.
- Image broadcast is push-only from gm-app (`POST /api/.../show-image`) — it
  does not open its own `socket.io-client` connection like player-app's
  `ShowImageListener` does; player-app is the receiver, gm-app is the sender.

## Running in dev

Two terminals:
```bash
npm run dev:client          # Vite dev server on http://127.0.0.1:5176
GM_APP_DEV_URL=http://127.0.0.1:5176 npm run electron
```

Without `GM_APP_DEV_URL` set, Electron loads `client/dist/index.html` — run
`npm run build:client` first if you want to test the production build.

## Testing against a server

Needs a server running with `AUTH_ENABLED=true` (see `../deploy/`) and a gm
account (`POST /api/auth/players` only creates player accounts — the gm
account is seeded separately, see server auth docs). Log in with the gm
account's username/password and the server's URL in the connect screen.

## Building the desktop installer

```bash
npm run dist
```
Uses the `build` block in `package.json` (`appId: com.rpgmanager.gm.mobile`,
same id shared with the Android target since this product only ships as one
or the other per install, never both from the same build) — output lands in
`release/`.

## Мобил-мастер (Android)

`capacitor.config.ts` points `webDir` at `client/dist` — `android/` is a
real, buildable Gradle project (scaffolded via `npx cap add android`), but
**actually building/running it needs Android Studio + the Android SDK** —
not available in the environment these commits were made from. What *was*
verified end-to-end in this environment: the built web client running in a
browser at desktop viewport, logging in as a gm account, browsing a
campaign's session (notes, playlist audio playback with auth-blob fetch),
browsing the bestiary and compendium, and triggering a real "показать
изображение" broadcast that a connected мобил-игрок/игрок-клиент instance
received and displayed via WebSocket — confirming the full auth + REST +
WebSocket + blob-media pipeline works, independent of the untested native
Android build step.

To pick up the native build on a machine with Android Studio installed:

```bash
npm run cap:sync           # rebuilds client/dist, copies it into android/, syncs plugins
npm run cap:open:android   # opens the project in Android Studio
```
From there, Run ▶ on a device/emulator like any Android project. Rerun
`cap:sync` after any change to `client/`.

iOS needs `@capacitor/ios` added and a macOS/Xcode toolchain — not attempted,
same reasoning as `../player-app`.

**CORS reminder:** the server's `ALLOWED_ORIGINS` needs the WebView's origin
— `https://localhost` on Android, `capacitor://localhost` on iOS (both
already listed in `../deploy/.env.example`) — or every request from the
mobile app is rejected before it reaches auth.
