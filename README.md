# csbot

A second-screen companion for Counter-Strike 2 squads.
- One teammate hosts a room from the desktop app. It reads their game through official Valve GSI and runs their own Claude Code.
- The rest of the squad joins from the web or the desktop app. Everyone sees the same scouting, live calls, and debrief, with their own job highlighted.

## Install

Download `csbot-Setup-<version>.exe` from the [latest release](https://github.com/grovic/csbot/releases/latest) and run it.
- It installs for your user only, with no admin rights.
- During the beta the installer isn't signed, so Windows shows "unknown publisher". Click **More info → Run anyway**.
- csbot updates itself.
- Uninstalling keeps your settings and recordings in `%APPDATA%\csbot`.

Teammates who only want to watch and log intel don't need it: they open the room's invite link in a browser.

## Status

**M1 (core host), M2 (rooms), M3 (Scout), M4a (live intel), M4b (real maps), M4c (T-side forecast), M4d (T playbook) and M5 (live coach) are built.**
- **M1:** the Electron host reads GSI, runs the economy engine, and shows the Live page.
- **M2:** the admin creates a room in the desktop app and shares an invite link. Teammates open it in a browser, or paste it into their own csbot, and see the same calls with their own job. Rooms are peer-to-peer: no account, no server.

- **M3:** paste a FACEIT match link and the Scout page shows both rosters: threat, form, map win rates, premades, Steam flags and a veto plan. Your own Claude Code writes a short briefing. Without API keys it runs on a fictional sample match.

- **M4a:** anyone in the room clicks a map zone to log what they see ("3 at B apps", "A clear"). The forecast and heat map update for everyone, and when the likely site flips the banner shows PLAN CHANGED with a mid-round call. Optional numpad hotkeys on the desktop app (off by default) log intel without leaving the game. Tournament mode refuses intel.

- **M4b:** the seven competitive maps (Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke) are real. Each map's floor, callouts and walking times come from the CS2 map files through `tools/map-build`. Every map has enemy plans with timed routes, a forecast on CT halves, and a CT playbook. Click anywhere in a zone to log intel. The demo plays on any map with `?map=de_dust2`.

- **M4c:** on your T halves, the map shows where their CTs likely hold and which site is likely light. Logging "4 on B" turns the call to "A likely light · go A".

- **M4d:** a T playbook for every map: a default, an A and a B exec, an eco and a force play, each with planned spots and a job for every player. The call picks by your money and their likely-light site, and switches to the right exec when intel comes in.

- **M5:** the host's own Claude Code writes the team call at every freeze time and after a plant, about 3 s after the engine's instant call. The squad asks it questions from the Coach page (per-member quota, per-match budget). Voice callouts read your job. Tournament mode turns it all off.

Calibrating the forecast with demos (rest of M4) and the debrief (M6) come next ([roadmap](docs/PROPOSAL.md#12-roadmap-v1-in-milestones)).

| Piece | Where | Run it |
|---|---|---|
| Web app (Live page; plays a fictional demo match when no host is connected) | `apps/web` | `pnpm dev:web`, then open `?speed=4` |
| Desktop host (GSI endpoint → spectator guard → recorder → engine → UI) | `apps/desktop` | `pnpm --filter @csbot/web build`, then `pnpm --filter @csbot/desktop start` |
| Engine, GSI parsing, wire types | `packages/{engine,gsi,protocol}` | `pnpm test` |
| Replay a recording or the synthetic match into a host | `tools/gsi-replayer` | see its README |
| Record GSI without the app | `tools/gsi-recorder` | see its README |
| Rooms: host, client, invite links, peer-to-peer transport | `packages/room` | `pnpm test` |
| Map geometry from the CS2 map files (zones, outlines, walking graph); per-map plays live in `packages/engine/src/maps/plays` | `tools/map-build` | see its README |
| Scouting: FACEIT/Steam clients, sample match, scouting math, AI report contract | `packages/scout` | `pnpm test` |
| Live coach: prompts, output schema, parsing, budget and quotas | `packages/coach` | `pnpm test` |
| Optional self-hosted signaling (tests, or squads that want their own) | `tools/room-relay` | see the file header |
| Spikes (M0) | `tools/spikes`, `tools/gsi-probe` | see each README |

**Checks:**
- `pnpm typecheck`
- `pnpm test` (unit tests)
- `pnpm --filter @csbot/web test:e2e` (Playwright, headless Edge)
- `pnpm --filter @csbot/desktop test:e2e` (Electron, hidden window)
- `CSBOT_LIVE=1` with the desktop e2e also runs `e2e/live.spec.ts`: the real path, with public Nostr signaling and a member on the live GitHub Pages site

## Design

**Proposal:** [docs/PROPOSAL.md](docs/PROPOSAL.md) covers rooms and roles, architecture (Electron + GitHub Pages + peer-to-peer rooms, no server), tech stack, feature list, roadmap, and the fair-play boundary.

**First test to run:** [tools/gsi-probe](tools/gsi-probe/README.md) is a 10-minute check that decides how teammates' positions work on the room map.

**Design demo:** open [docs/prototype/index.html](docs/prototype/index.html) in a browser. It's a single file with no dependencies, driven by a simulated GSI feed, and all players are fictional.
- **Pages:** Scout, Live, Debrief, plus header controls:
  - the room chip (room page)
  - speaker (voice callouts)
  - bot (Coach: chat and detailed panels)
  - gear (Settings)
- **Prototype bar:** plays the simulation, jumps to key moments, and switches **View as** between the admin (rdx, host) and a member (kairo). Watch the YOU line, map marker, and scoreboard row follow the viewer.
- **In Live:** click **＋ Log intel**, then click a map zone to update the forecast for the whole room.
- **Deep links:**
  - pages: `#scout`, `#debrief`, `#room`, `#setup`
  - Coach tabs: `#coach`, `#coach-economy`, `#coach-calls`, `#coach-config`
  - views: `#member` (view as kairo), `#ff=131` (fast-forward the simulation by 131 s)
- **Screenshots:** [docs/prototype/screens/](docs/prototype/screens/)
