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

**M1 (core host), M2 (rooms), M3 (Scout), M4a (live intel), M4b (real maps), M4c (T-side forecast), M4d (T playbook), M4e (squad markers), M5 (live coach), M6 (debrief), M7 (extras), M8 (hardening) and M9 (real-match kit) are built.**
- **M1:** the Electron host reads GSI, runs the economy engine, and shows the Live page.
- **M2:** the admin creates a room in the desktop app and shares an invite link. Teammates open it in a browser, or paste it into their own csbot, and see the same calls with their own job. Rooms are peer-to-peer: no account, no server.

- **M3:** paste a FACEIT match link and the Scout page shows both rosters: threat, form, map win rates, premades, Steam flags and a veto plan. Your own Claude Code writes a short briefing. Without API keys it runs on a fictional sample match.

- **M4a:** anyone in the room clicks a map zone to log what they see ("3 at B apps", "A clear"). The forecast and heat map update for everyone, and when the likely site flips the banner shows PLAN CHANGED with a mid-round call. Optional numpad hotkeys on the desktop app (off by default) log intel without leaving the game. Tournament mode refuses intel.

- **M4b:** the seven competitive maps (Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke) are real. Each map's floor, callouts and walking times come from the CS2 map files through `tools/map-build`. Every map has enemy plans with timed routes, a forecast on CT halves, and a CT playbook. Click anywhere in a zone to log intel. The demo plays on any map with `?map=de_dust2`.

- **M4c:** on your T halves, the map shows where their CTs likely hold and which site is likely light. Logging "4 on B" turns the call to "A likely light · go A".

- **M6:** the Debrief page.
  - From every match csbot is open for: the result, your rating, rounds won by side and by buy, the enemy money estimate per round, every round's reads and calls, and progress across matches.
  - Claude writes "work on next".
  - Add the match demo (from CS2's replays folder, or drop the file) to see how often the buy read and the site read were right, their real money, and where you died.

- **M7:**
  - Gather mode: with fewer than five of you in the room, the match's randoms take the free slots (the AWPer gets the AWP slot).
  - 2D round replay from the match demo on the Debrief page: movement, kills, smokes, molotovs and the plant, at 1×, 2× or 4×.
  - Playbook page: your own setups, calls, jobs and spots per map (drag them on the map), and anti-strats for an opponent: which plans they run more or never, your answer to each of their buys, and notes for the coach. The room admin's playbook goes to every member.
  - Lineups (Playbook page): csbot's starter smokes, molotovs and flashes per map, editable by the team and listed on the call card. Export a practice config for a private server: one command per lineup puts you on the throw spot with the grenade.
  - Wingman: 2v2 matches with 8-round halves, two positions, money calls (no site forecast: one site). The demo plays one with `?mode=wingman`.
  - Stream Deck plugin: intel, check-in, push-to-talk and team-call keys. Turn on Stream Deck in csbot's Settings, then open `com.grovic.csbot.streamDeckPlugin` from the release ([details](apps/streamdeck/README.md)).
  - Push-to-talk on the desktop app (off by default, Settings): press Num0 and say "three B apps", "palace clear", "rotating A" or "coach, should we save?". Windows recognizes the speech on your PC, offline.

- **M8:**
  - If the host's PC drops, a desktop member takes over the room with one click. Members follow by themselves, and the old host rejoins as a member when it comes back. Rooms expire a day after their last match.
  - Performance: about 160 MB and 0.2% CPU while hosting, flat over a 30-minute match. That's low-memory mode, on by default; csbot draws without the graphics card. The web app's first download is smaller.
  - Auto-updating installer.
  - The installer stays unsigned during the beta (decided 2026-10-22).

- **M9:**
  - The next round's call shows as soon as a round ends, and the host's Claude Code starts on it then, so its call is usually on screen before freeze time.
  - Measurement runs (the playtest build starts with `--metrics`) log memory, CPU, round ends and when each screen in the room shows each call. `tools/real-match` turns a run into the V1 numbers.

- **M4e:** squad markers in a room: each player's marker is planned, on spot, rotating to a site with a countdown, or dead. Players check in with buttons under the map, or Num5 / Num4 / Num6 on the desktop app. Positions are only what players report; the game never sends teammates' positions.

- **M4d:** a T playbook for every map: a default, an A and a B exec, an eco and a force play, each with planned spots and a job for every player. The call picks by your money and their likely-light site, and switches to the right exec when intel comes in.

- **M5:** the host's own Claude Code writes the team call for every round and after a plant, a few seconds after the engine's instant call. The squad asks it questions from the Coach page (per-member quota, per-match budget). Voice callouts read your job. Tournament mode turns it all off.

What's left for V1 needs real matches: accuracy on the squad's own demos, and footprint, call timing and reconnects measured during real games ([roadmap](docs/PROPOSAL.md#12-roadmap-v1-in-milestones)).

| Piece | Where | Run it |
|---|---|---|
| Web app (Live page; plays a fictional demo match when no host is connected) | `apps/web` | `pnpm dev:web`, then open `?speed=4` |
| Desktop host (GSI endpoint → spectator guard → recorder → engine → UI) | `apps/desktop` | `pnpm --filter @csbot/web build`, then `pnpm --filter @csbot/desktop start` |
| Engine, GSI parsing, wire types | `packages/{engine,gsi,protocol}` | `pnpm test` |
| Replay a recording or the synthetic match into a host | `tools/gsi-replayer` | see its README |
| Record GSI without the app | `tools/gsi-recorder` | see its README |
| Rooms: host, client, invite links, peer-to-peer transport | `packages/room` | `pnpm test` |
| Debrief: match records, stats, Claude's notes | `packages/debrief` | `pnpm test` |
| Demo reading (CS2 .dem → real money, plants, deaths) | `packages/demo` | `node packages/demo/src/cli.ts <file.dem>` |
| Map geometry from the CS2 map files (zones, outlines, walking graph); per-map plays live in `packages/engine/src/maps/plays` | `tools/map-build` | see its README |
| Scouting: FACEIT/Steam clients, sample match, scouting math, AI report contract | `packages/scout` | `pnpm test` |
| Live coach: prompts, output schema, parsing, budget and quotas | `packages/coach` | `pnpm test` |
| Optional self-hosted signaling (tests, or squads that want their own) | `tools/room-relay` | see the file header |
| The V1 numbers from a real match played with `--metrics` | `tools/real-match` | `node tools/real-match/src/report.ts` |
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

**Live demo:** [grovic.github.io/csbot](https://grovic.github.io/csbot/) runs the real web app on a fictional match. Add `?speed=4` to play it faster, `?map=de_dust2` for another map, or `?mode=wingman`.

**Design prototype (frozen):** [docs/prototype/index.html](docs/prototype/index.html) is the original clickable design, kept as a record since 2026-10-22; the live demo shows the app as it is. It's a single file with no dependencies, driven by a simulated GSI feed, and all players are fictional.
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
