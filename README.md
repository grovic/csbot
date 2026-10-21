# csbot

A second-screen companion for Counter-Strike 2 squads.
- One teammate hosts a room from the desktop app. It reads their game through official Valve GSI and runs their own Claude Code.
- The rest of the squad joins from the web or the desktop app. Everyone sees the same scouting, live calls, and debrief, with their own job highlighted.

**Proposal:** [docs/PROPOSAL.md](docs/PROPOSAL.md) covers rooms and roles, architecture (Electron + GitHub Pages + room relay), tech stack, feature list, roadmap, and the fair-play boundary.

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
