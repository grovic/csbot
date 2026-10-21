# csbot

A second-screen companion for Counter-Strike 2 squads.
- One teammate hosts a room from the desktop app. It reads their game through official Valve GSI and runs their own Claude Code.
- The rest of the squad joins from the web or the desktop app. Everyone sees the same scouting, live calls, and debrief, with their own job highlighted.

## Status

**M1 (core host) is built:** the Electron host reads GSI, runs the economy engine, and shows the Live page. Scouting, rooms, the forecast from demos, Claude calls, and the debrief come in M2–M6 ([roadmap](docs/PROPOSAL.md#12-roadmap-v1-in-milestones)).

| Piece | Where | Run it |
|---|---|---|
| Web app (Live page; plays a fictional demo match when no host is connected) | `apps/web` | `pnpm dev:web`, then open `?speed=4` |
| Desktop host (GSI endpoint → spectator guard → recorder → engine → UI) | `apps/desktop` | `pnpm --filter @csbot/web build`, then `pnpm --filter @csbot/desktop start` |
| Engine, GSI parsing, wire types | `packages/{engine,gsi,protocol}` | `pnpm test` |
| Replay a recording or the synthetic match into a host | `tools/gsi-replayer` | see its README |
| Record GSI without the app | `tools/gsi-recorder` | see its README |
| Spikes (M0) | `tools/spikes`, `tools/gsi-probe` | see each README |

**Checks:**
- `pnpm typecheck`
- `pnpm test` (unit tests)
- `pnpm --filter @csbot/web test:e2e` (Playwright, headless Edge)
- `pnpm --filter @csbot/desktop test:e2e` (Electron, hidden window)

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
