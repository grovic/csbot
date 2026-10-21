# AGENTS.md

Guidance for any coding agent working in this repository.

## Working agreement

- **The project owner does not run anything.** The agent does all of the work: installing dependencies, building, testing, git, screenshots, deployments, and maintaining docs.
- **The owner approves and discusses.** Ask with a yes/no or a short multiple-choice question, recommendation first, and batch questions together.
- **Ask before** anything outward-facing or hard to undo:
  - pushing to GitHub, publishing GitHub Pages or Releases, deploying the relay
  - creating accounts or spending money (code signing, paid tiers)
  - installing software or background processes on this PC
  - writing into the CS2 install folder
  - using real API keys
  - using the owner's Claude plan beyond small test calls
- **Never ask the owner to run a command.** When a human is truly needed (signing in to a site, creating an API key, playing a match), say exactly what is needed and why, and keep it to the minimum. Collect secrets with the secret-request tool, never in chat.
- **Report with evidence:** test output and screenshots. Say plainly what was not verified.

## Project

csbot is a second-screen companion for Counter-Strike 2 squads. An admin's desktop app hosts a room, and teammates join from the web app (GitHub Pages) or the desktop app.

- Source of truth: [docs/PROPOSAL.md](docs/PROPOSAL.md)
- Clickable design demo, fictional data: [docs/prototype/index.html](docs/prototype/index.html)
- When the UX changes, update the prototype and its screenshots in `docs/prototype/screens/`.

## Non-negotiable rules

**Fair play**
- Live game data comes only from official Valve GSI.
- Never:
  - read or write game memory, inject, or draw inside the game
  - capture packets
  - screen-capture or OCR the game (including the radar and TAB)
  - automate input
  - use `getpos` binds or scrape the console for positions
- Product GSI configs never request spectator-only components.
- While a match is live, the room-wide guard drops `allplayers_*`, grenades, and bomb data from every device.
- Enemy money and positions are always labeled as estimates.

**Claude Code**
- Spawn the user's own, unmodified `claude` binary.
- Never read, store, or proxy Claude credentials, and never offer a claude.ai login inside csbot.
- Don't use `--bare`, because it skips the subscription login.
- Keep "Claude" and "Anthropic" out of the product name and logo.
- Keep the per-match call budget and the per-member question quota.

## Environment (the owner's PC, which is also the gaming PC)

- Windows 11, 32 GB RAM, RTX 2080 Ti
- Node 24, pnpm 10, Python 3.14, Microsoft Edge (use headless for UI screenshots)
- Claude Code installed and signed in with claude.ai
- CS2 at `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive`. Leave the existing `gamestate_integration_logitech.cfg` untouched.
- `gh` CLI is not installed. Git remote: `https://github.com/grovic/csbot`

## Repository conventions

- pnpm workspaces + turbo monorepo, TypeScript everywhere. Layout in PROPOSAL §10: `apps/{desktop,web}`, `packages/{engine,gsi,protocol,ui}`, `services/relay`, `tools/`.
- Work on a branch per milestone or feature, and merge through reviewed PRs once the repo is on GitHub.
- **Tests:**
  - engine unit tests against fixtures and demo truth
  - GSI recorder/replayer for anything that would otherwise need a live match
  - Playwright for the UI
  - headless-Edge screenshots before calling UI work done
- Use fictional data in fixtures and the prototype. Never commit real API keys, tokens, or room keys.
