# @csbot/desktop

The Electron host. It receives CS2 GSI on localhost, runs the match tracker, records the session, and renders the web app (`apps/web`) with live snapshots.

```
CS2 ──HTTP──▶ GSI server (127.0.0.1:47400, token) ─▶ spectator guard ─▶ recorder (userData/recordings/*.ndjson)
                                                              └──────▶ MatchTracker ─▶ snapshot ─IPC─▶ renderer (window.csbot)
```

| File | Role |
|---|---|
| `src/main.ts` | Window, IPC handlers, single-instance lock, clean quit, metrics for spike 8 |
| `src/preload.ts` | Sandboxed bridge: exposes `window.csbot` (`CsbotBridge` from `@csbot/protocol`) |
| `src/host.ts` | The pipeline. Pure Node, so it's unit-tested over real HTTP |
| `src/cs2.ts` | Finds CS2 (registry → `libraryfolders.vdf` → `appmanifest_730.acf`) and installs `gamestate_integration_csbot.cfg`, only on a user click. Never touches other cfgs |
| `src/settings.ts` | `userData/settings.json` (GSI port and token) and env overrides |

## Run

```sh
pnpm --filter @csbot/web build      # the renderer
pnpm --filter @csbot/desktop start  # builds main/preload, launches Electron
```

`scripts/start.mjs` removes `ELECTRON_RUN_AS_NODE`. Some IDE terminals set it, and then Electron runs as plain Node.

### Feed it without a match

```sh
node tools/gsi-replayer/src/replay.ts --synthetic=full --runtime "<userData>/runtime.json"
```

On start the app writes `runtime.json` (GSI URL, token, pid) to its userData dir.

### Environment overrides

| Variable | Effect |
|---|---|
| `CSBOT_USER_DATA` | Use this folder as userData (tests and measurements) |
| `CSBOT_GSI_PORT` | GSI port for this run only. `0` picks a random port |
| `CSBOT_HIDDEN=1` | Never show the window |
| `CSBOT_WEB_URL` | Load the renderer from a dev server (`pnpm --filter @csbot/web dev`) |
| `CSBOT_STEAM_PATH` | Look for CS2 only under this Steam root. Tests point it at a temp tree |
| `CSBOT_METRICS_FILE` | Append `app.getAppMetrics()` once per second (spike 8) |

## Test

```sh
pnpm --filter @csbot/desktop test       # vitest: CS2 detection, cfg install, host pipeline over HTTP, settings
pnpm --filter @csbot/desktop test:e2e   # Playwright + Electron, hidden window, fake Steam tree
```

The e2e test needs `apps/web/dist`. It saves `screens/desktop-live.png`.

## Security

- The renderer runs with `contextIsolation`, `sandbox` and no Node integration.
- IPC handlers only answer our own page.
- Navigation away from the page is blocked; external links open in the browser.
- All permission requests are denied.
- The GSI server listens on 127.0.0.1 only and checks the token.
- Recordings redact the token.
