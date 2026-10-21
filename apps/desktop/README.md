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
| `CSBOT_SIGNAL` | Room signaling override (`wss://…`, or `ws://` on 127.0.0.1/localhost). Tests use a local relay |
| `CSBOT_CLAUDE_BIN` | Run this instead of `claude` (scouting report and live coach). Tests point it at `e2e/fixtures/fake-claude.mjs`, which also speaks stream-json |
| `CSBOT_COACH=off` | Start with the live coach off for this run, without saving it. The e2e helpers set it (and the fake claude) by default |

## Scouting (M3)

- **What runs where:** `src/scout/service.ts` holds the current `ScoutView`, fetches FACEIT and Steam data, and starts the AI report.
- **API keys** (`src/scout/secrets.ts`):
  - Stored in `userData/secrets.json`, encrypted with Electron `safeStorage` (Windows DPAPI).
  - With no OS encryption available, csbot refuses to save a key rather than store it in plain text.
  - The renderer only learns each key's state (`live` / `missing-key` / `error`). Keys never reach the room.
- **Cache** (`src/scout/file-cache.ts`): `userData/cache/scout.json`. Writes are debounced, expired entries are dropped, and the size is capped at 5 MB.
- **AI report** (`src/scout/claude.ts`):
  - Runs the user's own `claude` in an empty temp folder:
    `claude -p --output-format json --json-schema <schema> --model opus --effort high --system-prompt-file <tmp>/system.md --tools "" --strict-mcp-config --permission-mode dontAsk --no-session-persistence`
  - The scouting file goes on stdin. The run is killed after 90 s.
  - Budget: one automatic run per match plus 2 manual re-runs. Re-scouting a match keeps its last report.
- **Without keys:** "Try the sample match" scouts a fictional FACEIT match through the same code.

## Live coach (M5)

- **Session** (`src/coach/session.ts`): one warm `claude` per match, started on the first request.
  - Command, in an empty temp folder:
    `claude -p --input-format stream-json --output-format stream-json --verbose --json-schema <COACH_SCHEMA> --model <model> --effort <effort> --system-prompt-file <tmp>/system.md --tools "" --strict-mcp-config --permission-mode dontAsk --no-session-persistence`
  - Each request is one stream-json user line; the next `result` event carries `structured_output`.
  - One request in flight; game events go ahead of questions.
  - Soft timeouts: 12 s for calls, 30 s for answers. A reply after that is still handed over ("late"). A turn stuck for 60 s kills the process.
  - A crashed process restarts on the next request.
- **Service** (`src/coach/service.ts`): watches every host snapshot.
  - **New match:** resets the chat, the log and the budget, then sends a warm-up turn.
  - **Freeze time:** one call per round.
  - **Bomb planted:** one call per planted round, if post-plant calls are on.
  - **Game over:** closes the session.
  - Every request counts against the per-match budget (default 40). Members also have a question quota (default 5); the admin's questions only use the budget.
  - Over budget, coach off, no Claude Code, or tournament mode: the request is skipped and logged, and the engine call stays.
- **Which call shows** (`withCoachCall` in `src/host.ts`):
  - Claude's call replaces the engine's only for the round and call kind it was written for: the pre-round call until a plant, the post-plant call after.
  - The YOU line becomes our slot's job, except the "you're dead" line, which stays.
  - When Claude picks another playbook setup, the map's planned spots follow it.
- **Config:** `settings.json` → `coach` (enabled, model, effort, budget, quota, post-plant). The room's slots and tournament switch come from the renderer (`setRoomSlots`).
- **Footprint:** the app's own memory barely changes with the coach on.
  - Measured with the fake claude over 6 rounds: main process 78 → 79 MB private memory; app total 289 → 294 MB, which is within noise.
  - The real `claude` process runs beside the app and isn't counted here.

## Test

```sh
pnpm --filter @csbot/desktop test       # vitest: CS2 detection, cfg install, host pipeline, settings, scouting, coach
CSBOT_LIVE=1 pnpm --filter @csbot/desktop test   # adds real Claude Code calls (owner's plan): a scouting report, and a coach warm-up + one call
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
- API keys are encrypted at rest and never leave the main process.
- Claude Code runs with every built-in tool off, in an empty folder, and only ever answers with JSON.
