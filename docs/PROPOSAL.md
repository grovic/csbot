# csbot: V1 proposal

> Status: M1–M9 are built, with real maps for the whole pool (section 12 has the details). The beta installer stays unsigned (decided 2026-10-22). What's left for V1 needs real matches and demos (section 12, V1 exit criteria). The live demo at https://grovic.github.io/csbot/ runs the real web app on a fictional match. The clickable design prototype (`docs/prototype/index.html`, screenshots in `docs/prototype/screens/`) is the original design reference, frozen on 2026-10-22; its map is a hand-drawn sketch, while the app uses the real maps.
> Every player, stat, and demo in the prototype is fictional.

csbot is a second-screen companion for Counter-Strike 2, built for squads (5-stacks and gathers).
- **Before the match**, it scouts both teams from public data.
- **During the match**, it tracks economy, forecasts where the enemy probably is, and gives every teammate their own job for the round.
- **After the match**, it compares its estimates with the demo and tells the team what to work on.

How it runs:
- **One teammate (the admin) hosts a room** from the desktop app. That app reads their game, runs their own Claude Code, and holds the API keys.
- **Everyone else joins** from the web app (GitHub Pages) or the desktop app.
- **The whole squad sees the same screens.** Each player's own job, marker, and money are highlighted for them.

---

## 1. TL;DR

| Decision | Recommendation |
|---|---|
| Apps | **Electron desktop app** (host or member) and the **same React app on GitHub Pages** (member). Windows first. |
| Rooms | The admin's desktop app **hosts** a room, and squad members **join** with an invite link. Same screens for everyone, with a personal YOU. Roles: admin and member. |
| Room connection | **Peer-to-peer, no server, no accounts.** Members connect straight to the host's desktop app over WebRTC. The first handshake goes through public Nostr relays (open infrastructure), encrypted with the room key from the invite link. Nobody signs up anywhere and nothing runs in the cloud. |
| Live game data | **Valve Game State Integration (GSI) only**: the host's own GSI, plus each member's own GSI if they share it |
| Public data | FACEIT Data API, Steam Web API, Leetify (optional), demo files. All fetched by the host, so keys never leave the host. |
| AI layer | The admin's own **Claude Code CLI**, run headless (`claude -p`, stream-json) with a local MCP server. **One call per event, broadcast to the room.** |
| Real-time math | A shared TypeScript engine (economy, forecast, heat) that runs on the host and in every client |
| Scope | **Every feature in V1**, delivered in milestones (section 12) |
| Platform priority | **FACEIT first** (full rosters and stats). Premier is supported with partial scouting. |
| Fair-play stance | Never touch the game process, memory, network traffic, or input. Spectator-only data is dropped across the whole room. Everything inferred is labeled. |

---

## 2. Review of the idea

The idea is sound and buildable. Five hard constraints shape the design.

### 2.1 Constraints

1. **While you play, GSI only describes you.** `allplayers_*`, positions, grenades, and bomb position are only sent to spectators and GOTV. So there are **no live teammate or enemy positions** from the game. The minimap is a forecast and plan board, not a radar.
2. **"Fog of war" has to be inference.** It's built from the opponent's demo tendencies, a route-and-timing model of the map, and intel the squad logs ("2 at B apps", "palace clear").
3. **Claude takes seconds to answer**, roughly 1.5–4 s on a warm session. Local engines do everything real-time. Claude makes and explains decisions during freeze time, timeouts, and before/after the match.
4. **A static site can't host.** GitHub Pages can't receive GSI, run Claude Code, or call the Steam API (no CORS). So **the host is always the admin's desktop app**, and the web app is a member client.
5. **A shared room shares one Claude plan.** Calls are generated once and broadcast, so the cost doesn't grow with members. Member questions use the admin's plan, so they're capped (section 6).

### 2.2 Each requested feature against reality

| You asked for | Verdict | How |
|---|---|---|
| Recognize the current game (Premier, FACEIT, …) | ✅ | GSI `map.mode`/`map.name` + FACEIT match lookup (fallback: paste the room link) |
| Info on all 10 players | ✅ FACEIT · ⚠️ Premier | FACEIT gives the full roster with Steam IDs. Premier: GSI has no roster. Candidates are the console `status` output (via `-condebug`, **to verify**), the room members, and demos after the match. |
| Opponent stats, preferred maps | ✅ | FACEIT per-map stats, match and veto history; Leetify ratings; demo tendencies |
| Minimap with teammates' positions | ⚠️ room members, reported | The probe settled it in a real match: GSI sends players **no positions at all**, alive or dead. Room markers combine planned spots, one-key check-ins, rotations with a countdown, and deaths. Exact positions come in the post-match replay. See section 3.7. |
| Fog of war / enemy heatmap | ✅ as a forecast | Prior from demos + route timing + Bayesian update from the room's intel |
| Team budget | ✅ | Exact for every room member who shares their own GSI. Randoms come from the last time someone spectated them. |
| Enemy budget / eco detection | ✅ | GSI gives both teams' score, `consecutive_round_losses`, and how each round was won. Income model + spend priors, calibrated against demos. |
| Real-time strat suggestions | ✅ | Claude chooses from the team's playbook, grounded in engine outputs. Each player gets their own job. |
| Squad sees the same app | ✅ | Rooms (section 3) |

### 2.3 Fair-play boundary (non-negotiable)

**csbot does:**
- read official Valve GSI (localhost on desktops, or a token-protected room URL for web members)
- call public web APIs with the admin's own keys
- parse demo files the squad has, or downloads through official channels
- take input players type, click, or speak
- run in its own window or on a phone, with OS-level hotkeys on desktop

**csbot never does:**
- read or write game memory, inject DLLs, or draw an overlay inside the game process
- capture or decrypt network packets
- screen-capture or OCR the game, including the TAB scoreboard and the radar
- use `getpos` binds or scrape the console to get positions
- automate input
- show spectator-only data during a live match. The guard runs **room-wide**: if any device in the room (for example, someone watching GOTV) sends `allplayers_*`, positions, grenades, or bomb data, the host drops it. That blocks "ghosting" through the room.

Notes:
- FACEIT's anti-cheat starts CS2 with `-allow_third_party_software`, and csbot never touches the game process anyway.
- **League and tournament rules** can forbid real-time outside assistance. The admin's **Tournament mode** turns live coaching off for the whole room.

### 2.4 Claude Code as the AI layer: what is and isn't allowed

From Anthropic's Claude Code *Legal and compliance* page:

- ✅ **Allowed:** the host spawns the admin's **own, unmodified `claude` binary**, signed in through Claude Code's own flow (`claude auth login`). Anthropic states this does not prevent "an end user from signing in to the unmodified Claude Code binary with their own Claude subscription".
- ❌ **Not allowed:**
  - offering a claude.ai login inside csbot
  - collecting, storing, or proxying Claude credentials or tokens
  - routing requests through plan credentials on other users' behalf
  - modifying the binary
  - using "Claude"/"Anthropic" in our product name or logo. Plain text like "runs Claude Code" is fine.
- **Rooms:**
  - The admin's Claude Code coaches the admin's own team, and its outputs are shared with them, much like sharing a screen.
  - Members never get access to the admin's Claude account. They see results, and their questions are capped per match (default 5).
  - Plan limits assume ordinary individual use, so the per-match call budget stays on, and a team that needs more can switch the host to an **Anthropic API key**.
  - If csbot is ever offered as a **commercial service**, confirm the setup with Anthropic first.
- **Usage:** `claude -p` counts against the admin's plan limits. Anthropic announced, then paused, a separate Agent SDK credit, so re-check before launch.
- **Don't use `--bare`.** It skips the subscription login.

---

## 3. Rooms

### 3.1 Who runs what

| Capability | Admin · desktop (host) | Member · desktop | Member · web (GitHub Pages) |
|---|---|---|---|
| See every page, live | ✅ | ✅ | ✅ (also on a phone) |
| Personal YOU line, marker, money | ✅ | ✅ | ✅ |
| Log intel, ask the coach, vote on calls | ✅ | ✅ | ✅ |
| Own GSI shared with the room | ✅ local | ✅ local → room | ❌ (a browser can't receive GSI; install the desktop app to share) |
| Global hotkeys, voice callouts | ✅ | ✅ | voice only |
| Runs Claude Code, engines, API calls, demo parsing | ✅ | only after a handover | ❌ |
| Change calls, playbook, AI settings, permissions | ✅ | ❌ | ❌ |

### 3.2 Roles and permissions

- **Admin:**
  - creates the room and hosts it (GSI, Claude Code, keys, demos)
  - approves joins, removes members, and makes another member admin
  - sets permissions and team settings, and turns tournament mode on or off
  - hands hosting over to another desktop member
- **Member:** sees everything. Can log intel, ask the coach (within their quota), vote on calls, share their own GSI, and edit their own positions.
- **Random** (not a role, a status): a teammate in the match who isn't in the room. They're still scouted, still get a suggested spot in every call (from their history), and the IGL passes it on in voice.
- The admin controls these permissions: members log intel · members ask the coach (quota) · members edit their own position · tournament mode. Calls, the playbook, and AI settings stay admin-only.
- *Possible later addition:* a read-only **guest** (coach or analyst friend). It's easy to add, but not needed for the V1 roles.

### 3.3 Joining and identity

- **Inviting:**
  - The admin shares an invite link: `https://grovic.github.io/csbot/#/r/K7P2QX?k=<room-key>`.
  - The key sits after `#`, so it's never sent to any server.
  - Opening the link asks for a name, then the admin approves once. Approved devices are remembered, so they rejoin without asking again.
- **Identity:**
  - Desktop members are identified automatically by the Steam ID in their own GSI (`provider.steamid`), matched against the FACEIT roster.
  - Web members pick their roster slot, and the admin approves.
- **Room lifetime:** a room lives for the match plus 3 hours. The admin can regenerate the code at any time.

### 3.4 Sync model

- **The host is authoritative.** It holds the `RoomState`:
  - match, round, phase
  - economy model
  - forecast posterior
  - current call with a job per player
  - scoreboard, feed, and the debrief once the match is over
- **Host → room:**
  - one `snapshot` when someone joins
  - then `patch` messages (Immer patches with a sequence number, at most ~4 per second)
  - discrete `event`s (new call, plan changed, bomb planted)
- **Member → host:** `intent` messages (`intel`, `ask`, `vote`, `position`), plus `gsi` when the member shares their own GSI. The host validates them, applies them, and rebroadcasts.
- **Each client runs the same `packages/engine`.** Only compact state goes over the wire: the plan posterior, the round clock, and intel. Every client renders the heatmap and timings locally, which keeps traffic to a few KB per update and the animation smooth.
- **Duplicate intel** (same zone within 3 s from two players) is merged, and each event keeps its author ("kairo: 3 at B apps").
- **Added latency:** host → member is one direct WebRTC hop, typically 20–80 ms. That's negligible next to the 3–5 s AI calls.

### 3.4b How devices connect (no server, no accounts)

Joining has to be as simple as opening a link: no sign-up for anyone, nothing to host, nothing to pay.

- **Topology:** a star. Each member opens one WebRTC data channel to the host's desktop app. WebRTC is built into every browser, so this works from the GitHub Pages site and from phones.
- **Finding each other (signaling):**
  - Peers exchange their connection offers through **public Nostr relays**. Nostr is an open protocol with many free relays and no accounts.
  - The open-source **Trystero** library (MIT) handles this, with several relays at once for redundancy. BitTorrent trackers or MQTT brokers are fallback options it supports too.
  - The offers are encrypted with the room key, so the relays only see an opaque blob under a hashed room ID. Room data never touches them; it flows directly between devices.
- **Getting through home routers:**
  - Public STUN servers (no account) let most home connections reach each other directly.
  - **Same network** (LAN party, same house): direct, always works.
  - **Strict networks** (some mobile carriers, corporate or school networks) can block direct connections. Those members need a TURN server that forwards traffic. Options, none of them needed for normal use:
    - the host's desktop app offers itself as the forwarder when the router allows it (UPnP)
    - a squad that wants it can run the open-source coturn with one command
  - M2 measures how often direct connection fails across the squad's real networks.
- **Encryption and access:**
  - Trystero encrypts every connection offer with the room key (AES-GCM). A device without the invite link can't even complete the handshake; the spike's wrong-key peer was refused at that step.
  - WebRTC then encrypts every channel (DTLS).
  - The host also checks every message from members against a schema, and rate-limits them.
- **What others can see:**
  - People in the room see each other's IP addresses, as in any peer-to-peer game. Trystero links every device in a room, and csbot only uses the member ⇄ host links; member ⇄ member links stay idle.
  - The public relays see that someone joined *a* room, never which room or what was said.
- **Rejected alternatives:**
  - a hosted relay (Cloudflare, Supabase, PartyKit): somebody has to create an account and run it
  - the host as a plain WebSocket server: members would need port forwarding on the admin's router
  - Tailscale or ZeroTier: everyone needs an account

### 3.5 Same screen, personal YOU

- Every call carries **one job per player**, for example:
  - rdx: "A site alone, fall back to CT"
  - kairo: "B bench, long angles only"
- Each client renders its own job as the YOU line, highlights its own marker on the map and its own row in the scoreboard, and uses its own money for the buy tile.
- The team headline uses names ("B hit → rdx rotates to B"), and each player's own screen turns that into "you rotate".
- Voice callouts run on each device and read that player's own job.

### 3.6 Gather mode

The host compares room members with the FACEIT roster:
- **5 in the room:** 5-stack mode.
- **Fewer than 5:** gather mode. Each random gets the spot they play most (from FACEIT and demos). Calls avoid relying on randoms for key utility, and the IGL relays their part in voice.
- **Randoms' money and stats** come from the last time someone in the room spectated them.

*Built (M7):* when the scouted roster has randoms, they take the slots nobody in the room plays. A random scouted as an AWPer gets the AWP slot and an entry gets the entry slot; the rest fill what's left, the AWP slot last. Their slots show as open on the map (nobody checks in for them), and the calls name them so the IGL can relay their part.

### 3.7 Squad positions on the map

Every source of teammate positions we considered:

| Source | Exact? | Status |
|---|---|---|
| A player's own GSI while alive (`player_position`) | yes | **Not sent.** Probe, competitive de_dust2, 2026-10-21: 0 of 299 payloads while alive had a position, even with `player_position` requested. |
| A **dead room member's** GSI while they watch a teammate | yes | **Not sent.** Same probe: GSI follows the watched teammate (name, team, state) but 0 of 180 payloads had a position. Dead members still log intel from what they watch. |
| A coach seat (FACEIT/ESEA coach slot) in the room | yes, whole team | Optional for squads with a coach. Platform rules vary, and only our own team's data is kept. |
| Planned spot from the call (the player's job) | no, planned | Always available. Drawn as a dashed marker. |
| One-key check-ins: on my spot (Num5), rotating A/B (Num4/6), tap on phone, voice "I'm short" | no, reported | Always available. Solid marker. A rotation animates along the route with a countdown (rotation time from demos). |
| Alive/dead, HP, flash, weapon from each member's GSI | yes (not position) | Always available. A death freezes the marker as ✕ where it was. |
| Post-match demo | yes, after the match | 2D replay with real positions |

**Rejected**, because each is either a fair-play risk or fragile:
- screen capture or CV of the in-game radar
- `getpos` binds plus console-log scraping
- watching our own match on GOTV (ghosting)
- anything that reads memory

**Marker states on the Live map:**
- planned spot (dashed)
- checked in (solid)
- rotating (moving, with "→ B · 6 s")
- live (pulsing ring, "via rdx")
- dead (✕)

Randoms show their planned spot and a "random" tag, unless a dead room member is watching them. In that case they go live too.

*Built (M4e):*
- In a room, every slot's marker is shown to everyone: planned (dashed), on spot (solid), rotating (moving along the route to the site with a countdown) and dead (✕).
- Players check in with "On my spot" and "Rotating → A / B" buttons under the map, or Num5 / Num4 / Num6 on the desktop app.
- Deaths come from each player's own GSI shared through the room.
- Check-ins reset every round.
- Slots nobody in the room plays stay on their planned spot.

**Fair play:** these are only our own team's positions, which every teammate already sees on their in-game radar. Enemy data never enters the room, and the room-wide guard drops `allplayers_*` from every device.

### 3.8 Host failure and handover

- **If the host drops**, the room shows "host offline" and pauses. Members keep reconnecting through the same room ID.
- **Every member keeps the last snapshot** locally, so nothing is lost when the host's PC crashes.
- **To take over**, the admin (or any desktop member with Claude Code, if the admin allows it) becomes the new hub. They resume from the newest snapshot any member has, keeping the round history and economy model. API keys don't transfer. The new host uses their own, or runs without scouting refresh.
- *Built (M8):*
  - **Taking over:** after the host has been offline for 10 s, a desktop member sees "Take over as host".
    - The room keeps its code, key and members, and everyone rejoins without being asked.
    - The match read continues from the new host's own csbot, which tracked the match from their own game data all along.
    - The admin can turn this off ("Members take over hosting").
  - **Who hosts:** every hosting generation has an epoch, and members follow the newest. If the old host's csbot comes back, members tell it, and it steps down and rejoins as a member without approval.
  - **Expiry:** rooms expire a day after their last match.

### 3.9 Security and privacy

- **End-to-end encryption:**
  - Connection offers are encrypted with the room key from the link fragment (AES-GCM), so only key holders can connect.
  - Room traffic then flows over WebRTC's DTLS-encrypted channels, directly between devices.
  - The public signaling relays only see encrypted offers under a hashed room ID.
- **No secrets in the web bundle.** API keys, Claude credentials, and demo files stay on the host.
- **Member GSI:**
  - each member's room GSI cfg carries a per-member token
  - the host accepts only allow-listed GSI components
  - spectator-only data is dropped
- **Host limits:** the host caps connections per room, rate-limits intents, and only accepts members the admin approved.
- **Web app hardening:** a strict Content-Security-Policy and no third-party scripts.

### 3.10 Cost

- **GitHub Pages** (web app) and **GitHub Releases** (desktop installers and auto-update): free.
- **Rooms:** free. No server: devices talk directly, and the public Nostr relays only carry the handshake.
- **Windows code signing** is the main recurring cost. It avoids SmartScreen warnings and anti-virus false positives.

---

## 4. Architecture

```
            ┌────────────────────── Admin's PC (host) ───────────────────────┐
 CS2 ──GSI─▶│ Electron main (Node)                                            │
 (localhost)│  gsi server · spectator guard · recorder                        │
            │  engine (shared TS) · sources (FACEIT/Steam/Leetify) · demo     │
 claude CLI │  ai orchestrator ⇄ MCP server (127.0.0.1)                       │      ┌─ public Nostr relays ─┐
   ⇅ MCP    │  room host: RoomState → snapshot/patches · intents in           │◀ ─ ─▶│ handshake only,       │
            │ Renderer: React UI + room hub (WebRTC)                          │      │ encrypted offers      │
            └──────────────────────────────▲──────────────────────────────────┘      └───────────▲───────────┘
                                           │ WebRTC data channels (DTLS + AES-GCM), direct        │ handshake
                              ┌────────────┴──────────────────────┐                               │
                              │ Members: web app (GitHub Pages)   │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘
                              │ or desktop app (+ own local GSI)  │◀── member's CS2 (desktop members)
                              └───────────────────────────────────┘
```

**Event flow on the host:**
1. A GSI payload (the host's own, or a member's via the room) passes the spectator guard and becomes a normalized `GameState`.
2. The host diffs it against the previous state and emits domain events (`FreezeStarted`, `RoundLive`, `BombPlanted`, `RoundEnded{winner, reason}`, `MoneyChanged`, `MatchEnded`).
3. The engines update, and the `RoomState` patch goes to the local UI and to every member's data channel.
4. The AI orchestrator subscribes to a few of those events, each with a latency budget. Its `publish_call` output becomes part of the `RoomState`.

---

## 5. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Desktop shell | **Electron** + electron-builder (NSIS) + electron-updater from GitHub Releases | One TypeScript codebase with the web app, and Node for the GSI server, Claude CLI, MCP, and SQLite. (Tauri is lighter, but would split the code into Rust plus TS and can't reuse Node services.) |
| Web app | Vite + React 19 + TypeScript, static build on **GitHub Pages**, hash router | Free hosting. Works as the member client, and as a public demo mode with the simulator. |
| UI | Zustand, TanStack Query, Tailwind, Radix primitives | Mainstream and fast to iterate |
| Shared engine | `packages/engine` (pure TS): economy, forecast, heat, playbook | Runs on the host and in every client, so the wire format stays tiny |
| Host services (Node) | fastify (GSI), better-sqlite3, `@laihoe/demoparser2` (worker thread), `@modelcontextprotocol/sdk` (MCP server), `child_process` for `claude` | All local to the admin's PC |
| Room connection | WebRTC data channels, **Trystero** (MIT) for signaling over public Nostr relays, public STUN; optional TURN (coturn) for strict networks | No server and no accounts for anyone. Works in browsers and in Electron's renderer. |
| Protocol | zod schemas in `packages/protocol`, Immer patches, WebCrypto AES-GCM | Validated, versioned, and encrypted on both ends |
| Minimap / charts | Canvas 2D heat + SVG/HTML overlays; small hand-rolled SVG charts (d3-scale/d3-shape) | The prototype shows this is cheap |
| Voice | Web Speech API for TTS; push-to-talk with whisper.cpp on desktop | Offline, no extra cost |
| Hotkeys | Electron `globalShortcut` | OS-level. Nothing is sent to the game. |
| Testing | GSI recorder/replayer, engine golden tests against demo truth, Playwright (Electron + web), room tests over a local signaling stub, prompt eval set | Real matches can't be part of CI |

**Footprint while gaming:** Electron uses about 250–400 MB of RAM. To keep that down, the host runs one window with no GPU-heavy rendering and keeps demo parsing in a worker that only runs between matches. The budget is checked in M0.

---

## 6. AI layer design

### 6.1 Sessions and model routing (host only)

| Role | Model (alias) | Effort | Process | Trigger | Budget |
|---|---|---|---|---|---|
| Analyst (scouting report) | `opus` | high | one-shot, facts in the prompt, `--json-schema` (no tools) | match scouted | ≤ 60 s (measured 16.9 s) |
| Live coach | `sonnet` (or `haiku`) | low | **one long-lived stream-json process per match**, `--json-schema` on every turn (no MCP server needed) | match start (warm-up), round end (the next round's call; freeze time after a half starts), bomb planted | ≤ 4 s (measured 3.1 s warm) |
| Member questions | same live session | low | — | question from any room member, within quota | ≤ 4 s |
| Debrief | `opus` | high | one-shot | demo parsed | ≤ 2 min |

```bash
claude -p --input-format stream-json --output-format stream-json --verbose \
  --session-id <match-uuid> --model sonnet --effort low \
  --system-prompt-file prompts/live-coach.md \
  --mcp-config mcp/csbot.json --strict-mcp-config \
  --tools "" --allowedTools "mcp__csbot__*" --permission-mode dontAsk
```

- It runs in an empty, app-owned working directory, so no project `CLAUDE.md` or `.mcp.json` gets picked up.
- `--strict-mcp-config` loads only our MCP server, and `--tools ""` removes the built-in tools.
- `--allowedTools "mcp__csbot__*"` and `dontAsk` mean nothing ever prompts.
- `--system-prompt-file` replaces the coding-assistant persona.
- `--session-id` allows `--resume` after a crash or a host handover.

### 6.2 Output contract: structured output, not prose

> **As built (M3, M5):**
> - The analyst and the live coach both use `claude -p --json-schema`. Claude Code then returns `structured_output` on every turn of a warm stream-json session, so no MCP server or local tool endpoint is needed.
> - Calls and answers share one schema, with a `type` field.
> - Facts go in each message.
> - The host validates the output: only known slots and real playbook setups survive.
> - The MCP design below stays an option for read tools later.

- Claude publishes through **MCP tools with strict schemas**:
  - `publish_call` (headline, sub-line, steps, and **one job per player**)
  - `publish_note`
  - `publish_report`
- The host validates each one and broadcasts it as soon as the tool call arrives.
- **Read tools:**
  - `get_match_state`, `get_economy`, `get_forecast`
  - `get_player_dossier(id)` and `get_team_tendencies(map, side, buy)`
  - `get_playbook(map, side)`
  - `get_room`: members, randoms, positions, IGL

### 6.3 Grounding and guardrails

- **Engines compute every number.** Claude never invents a stat, and each call's "why" facts come from tool outputs.
- **Calls are picked from the team's playbook**, so map markers and jobs stay deterministic.
- **Graceful degradation:** if Claude is slow, rate-limited, or signed out, the engine produces a template call, labeled as engine-made.
- **Budgets:**
  - a per-match call budget (e.g. 40), then engine-only calls
  - a per-member question quota (default 5 per match)
  - both visible in Coach → Call log
- **Feedback** (votes, and whether each call was followed) is stored next to the round outcome. That feeds the debrief and the prompt eval set.

### 6.4 Latency budget per round

Target: **the call is on every screen ≤ 8 s after the round ends (p95)**. The pipeline: engine (<50 ms) → delta prompt (~1–2k tokens) → model → `publish_call` → direct WebRTC to every member (~20–80 ms). Freeze time length is **to verify** (about 15–20 s); the tracker learns it from the first full freeze it sees.

**Asked at round end (M9, 2026-10-22).** CS2 waits about 7 s between the end of a round and the next freeze time, so asking Claude only at freeze time would put its call on screen 10–12 s after the round ended. Now the engine works out the next round's call as soon as a round ends (from the enemy's new money band and our money; a dead player's money plus what the round paid). Every screen shows it right away, and the coach asks Claude then, with the next round's facts. Claude's call usually lands before freeze time starts. Two exceptions: before a half's first round (sides swap, money resets) and once the match is decided, the round-over card stays and freeze time asks as before. Freeze time redoes the engine's call from the freeze payload; in the synthetic matches it's the same call every time. Measured end to end with the fake `claude` (`apps/desktop/e2e/realmatch.spec.ts`); the real timing comes from the first real match (`tools/real-match`).

**Measured (M0 spike 5, `tools/spikes/claude-latency`):** on a warm `claude -p` session, the call reached the screen in **3.1–5.4 s with Sonnet** and 2.6–3.3 s with Haiku. Haiku's calls had tactical mistakes, so Sonnet at low effort is the default. The spike also set four rules:
- the tool schema has no length limits (trim server-side; a rejection costs a retry)
- the event message carries the facts (no state tool on the live path)
- a warm-up turn at match start
- the engine's call shows instantly and Claude's replaces it

---

## 7. Engines

### 7.1 Game state and events
- **GSI config:** `throttle 0.25`, `buffer 0.1`, `heartbeat 10`, `auth.token`.
  - **Requested:** `provider`, `map`, `round`, `player_id`, `player_state`, `player_weapons`, `player_match_stats`.
  - **Never requested:** `allplayers_*`, `bomb`, `allgrenades`. The generator (`packages/gsi/src/cfg.ts`) refuses them.
  - **Not requested yet:** `map_round_wins`, `phase_countdowns`, `player_position`. Whether a playing client gets them is unconfirmed.
- **Works without those three:** round results come from phase transitions, `win_team`, the bomb state and score changes, and timers from phase start times. Inferred round reasons are marked as inferred. If the game sends `map.round_wins` or `phase_countdowns`, the tracker uses them.
- **Recording:** payloads are deduped by `provider.timestamp`, and everything is recorded to NDJSON for the replayer.
- **Room-wide spectator guard:** spectator-only nodes from any source are dropped while a match is live.

### 7.2 Economy engine
- **Inputs:**
  - both teams' `score` and `consecutive_round_losses`
  - round results (from transitions, or `map.round_wins` when sent)
  - `round.bomb`
  - every shared player's `money` and `equip_value`
- **Rules table** (versioned data):
  - start $800, cap $16,000
  - loss ladder $1,400 → $3,400
  - win $3,250 (elimination/time) or $3,500 (bomb/defuse)
  - plant bonus, kill rewards, CT bonus per T kill, overtime money

  Phase 0 checks these values against demo truth.
- **Enemy money:** an interval per player, updated by income minus spend. Spend depends on the predicted buy type, and survivors keep their weapons.
- **Buy types:** probabilities come from the money band plus team tendencies. Projections cover "if they win / if they lose".
- **Your team's money** is exact for every player who shares their GSI. That powers the "can we full-buy?" view.
- **Calibration:** band coverage and buy-read accuracy are measured against demo truth after every match.

### 7.3 Position forecast ("fog of war")
- **Map geometry** for the seven competitive maps comes from the CS2 map files: the nav mesh (walkable floor) and the `env_cs_place` callout volumes (the place names CS2 itself uses).
  - `tools/map-build` reads these on the developer's PC and generates zone outlines, a lookup grid, a walking graph and earliest arrival times. The app ships that output; users' copies never read game files.
  - No Valve radar art is used.
  - Demo positions (`last_place_name`, trajectories) will later calibrate timings and plan odds.
- **Plans:** T plans (lineups, routes, timing distributions) and CT setups.
- **Prior:** P(plan | opponent, buy type, score state) from the opponent's demos. When there's little data, it falls back to population priors.
- **Heat** is a mixture over plans × players × timing, masked to walkable areas, with a "+10 s" preview.
- **Evidence:**
  - intel from **any room member** as zone, count (0 = clear), time, and author
  - each item feeds a tempered Poisson likelihood, so one call never reaches 100%
  - the result is a plan posterior and site probabilities
  - above about 0.8, a mid-round call with a rotation path
- **Bomb planted** comes from GSI. The site is inferred and confirmed with one tap.

### 7.4 Scouting engine
- **Status (M3):** built in `packages/scout`. Clients follow FACEIT's published Data API v4 spec and the Steam Web API. A fictional sample match stands in until the owner adds keys.
- **Finding the match:**
  - **FACEIT:** paste the match room link. The Data API has no "current match" endpoint; automatic detection gets checked with a real key (spike 4).
  - **Premier:** no roster API, so opponents are learned from the demo after the match.
- **FACEIT:** roster, lifetime and per-map stats, recent matches, veto history.
- **Steam:** summaries, bans, playtime (public profiles).
- **Leetify:** ratings (optional).
- **Demos:** roles, positions per side ("where he plays"), plan frequencies.
- **Derived:**
  - threat score, with the weights shown in the UI: ELO 35%, K/D 35%, form over the last 5 matches 15%, K/D on the current map 15%
  - premade detection: two enemies who played at least 5 of their last 20 matches on the same team
  - win chance: FACEIT's own estimate when the match has one, otherwise ELO, nudged by the map edge (at most ±8 points)
  - veto advice: ban the maps with the worst edge, expect them to ban the maps they rarely play, pick the best remaining edge
  - Steam flags: bans on record, accounts under a year old, few CS2 hours for a high ELO, private profiles
  - suggested roles for our team
  - each random's usual spot

### 7.5 Intel input
- **Every client:** map click.
- **Desktop:** numpad hotkeys, a Stream Deck plugin, and push-to-talk voice ("two B apps").
- **Phones:** large tap targets.
- Intel is always what a player asserts they saw.

---

## 8. Feature list (all in V1)

### Platform and rooms
- Electron desktop app (host or member) and the web app on GitHub Pages (member client, plus a public demo mode)
- Create a room, invite link, approve joins, roles (admin/member), permissions, randoms, host handover, room expiry
- Members share their own GSI automatically from the desktop app (the web app views, logs intel and asks)
- Peer-to-peer rooms with no server and no accounts: end-to-end encryption, presence, reconnects, last snapshot kept on every device
- Auto-update from GitHub Releases, signed installer

### Scout
- versus header (avg ELO, room members vs randoms, win chance) and the "3 things to know"
- enemy player cards (role, level, ELO, threat, key stat, one "how to play him" tip)
- per-player detail: tendencies, stats by map, "where he plays" mini-map per side
- how they play the map (T-side plan frequencies, CT setups), visual map veto
- your team: suggested roles, room status, randoms' usual spots
- AI scouting report (full text on the Coach page)

### Live
- phase banner, one team call with a personal YOU line, three answer tiles (enemy buy · likely hit · your buy), ticker
- forecast minimap with **squad markers**: planned, checked in, rotating with a countdown, live through a dead teammate's GSI, dead. Also an "on my spot" button and hotkeys, randoms tagged, rotation arrows, T timings, intel pins with authors, and a "+10 s" preview.
- TAB-style scoreboard with the round history. Each value shows its source: host GSI, member GSI through the room, or randoms from spectate snapshots. Enemy rows show their pre-match profile.
- voice callouts per device, intel from everyone, plan-changed alerts

### Debrief
- KPIs: result, your rating, buy-read accuracy, site-read accuracy, calls followed
- "work on next" from the AI
- enemy money per round (bars for truth, whiskers for the estimate)
- final scoreboard with the round strip
- win rate by your buy, the opening duel, call followed, and site defended or attacked
- where *you* died (personal per member), round-by-round table
- demo ingest: replays folder, drag-and-drop, and FACEIT once Downloads API access is granted

### Coach (chat on the right, detailed panels on the left)
- room chat with the coach, shared by everyone, with a question quota for members
- round reasoning: every player's job, facts, alternatives, plan probabilities (now vs before intel), site forecast, intel log
- economy: enemy model, your team's money, the rules table
- scouting data: full report, data sources, raw stats
- call log: model, latency, tokens, who asked, and whether the call was followed
- coach config (admin): models and effort, call budget, member quota, team mode, call length, prompts, team playbook

### Settings and fair play
- **Admin:** host connections (GSI, Claude Code, keys, room network, demos), advanced (GSI cfg, last payload)
- **Member:** your device (room connection, GSI sharing)
- **Everyone:** screen, voice, and hotkeys
- Room-wide tournament mode, room-wide spectator guard

### Also in V1 (previously V1.x / V2)
- Push-to-talk voice questions and intel (desktop) and a Stream Deck plugin
- 2D round replay viewer and a utility lineup library linked to playbook calls
- Anti-strat builder for a specific opponent; the team playbook shared by the room
- Progress tracking across matches (per player and per team), Wingman support, practice-config export (lineups for a private server)
- Phone as second screen: free with the web app
- Premier roster from a pasted console `status` (csbot never reads the console)
- Portrait (1080×1920) layout

---

## 9. UX principles

The app has four pages, plus header controls:
- **Scout** before the match, **Live** during rounds, **Debrief** after the match. These are the header tabs, in the order of a match.
- **Coach** (bot icon): the chat plus every detailed panel the other pages draw from.
- **Room** (room chip: code, members online, your role).
- **Voice** (speaker icon).
- **Settings** (gear icon).

The Live screen is built for a one-second glance:
1. **Phase banner.** Freeze time (blue), live (green), plan changed (amber), bomb planted (red), round over (gray), plus the one timer that matters in that phase.
2. **One call.** A team headline, one sub-line, a highlighted **YOU** line with that player's own job, then at most three short chips. "Why this call?" opens on demand.
3. **Three answer tiles, always in the same place:** enemy buy · likely hit (or the inferred bomb site after a plant) · your buy (then "if the round is lost: save / play on").
4. **Simplified map:** a large YOU marker, teammates, a rotation arrow, intel pins. Squad markers show how sure each position is: dashed = planned, solid = checked in, pulsing = live, ✕ = dead. Timings show only early in the round.
5. **One ticker line** for the latest event. It links to Coach.
6. **Scoreboard below the fold**, like holding TAB, with each value's source labeled.

Principles behind it:
- **Don't repeat the game HUD.**
- **Same place, every phase.**
- **Same screen for the whole squad, with a personal YOU.**
- **Color means team, not side.** We are blue and they are amber, and the side shows as a CT/T badge. Status colors mean status only, always with a label.
- **Everything inferred is labeled.**
- **Layout:** landscape puts the call column nearest the main monitor (a setting). Portrait and phones stack call → tiles → map.

---

## 10. Repository layout (monorepo, pnpm workspaces + turbo)

```
csbot/
├─ apps/
│  ├─ desktop/          # Electron main + preload: GSI server, Claude Code supervisor, MCP, SQLite, demo worker, room host
│  └─ web/              # React UI. Built for GitHub Pages and loaded by the Electron renderer
├─ packages/
│  ├─ engine/           # economy, forecast, heat, playbook (pure TS, unit-tested)
│  ├─ gsi/              # GSI types, diff → domain events, spectator guard
│  ├─ protocol/         # room messages (zod), patches, WebCrypto helpers
│  ├─ room/             # WebRTC rooms: signaling (Trystero/Nostr), host hub, member client
│  └─ ui/               # shared components: minimap, charts, cards
├─ data/maps/<map>/{zones.json,routes.json,playbook.yaml} · data/rules/economy.v1.json
├─ prompts/{analyst.md,live-coach.md,debrief.md}
├─ tools/{gsi-probe,gsi-recorder,gsi-replayer,map-builder}/
└─ docs/{PROPOSAL.md,prototype/{index.html,screens/}}
```

**CI (GitHub Actions):**
- `web` builds to GitHub Pages
- `desktop` builds a signed installer to GitHub Releases, which drives auto-update
- tests run on every PR

## 11. Data model

**Host (SQLite):**

| Table | Key columns |
|---|---|
| `players` | `steam_id` PK, `faceit_id`, `nickname`, `last_seen` |
| `player_stats` | `player`, `source`, `map`, `payload_json`, `fetched_at` (TTL) |
| `matches` | `id`, `platform`, `map`, `started_at`, `result`, `demo_id`, `room_code` |
| `match_players` | `match`, `player`, `team`, `party`, `in_room` |
| `rounds` | `match`, `n`, `winner`, `reason`, `est_lo`, `est_hi`, `buy_read`, `buy_truth`, `call_id`, `followed` |
| `tendencies` | `subject`, `map`, `side`, `buy_type`, `plan`, `count`, `timing_stats` |
| `intel` | `match`, `round`, `t`, `zone`, `count`, `author`, `source` |
| `ai_calls` | `match`, `round`, `role`, `model`, `latency_ms`, `tokens_in`, `tokens_out`, `asked_by`, `payload_json`, `votes` |
| `rooms` / `room_members` | `code`, `created_at`, `expires_at` / `room`, `player`, `role`, `device`, `shares_gsi` |

**Members (in memory / IndexedDB):** the last snapshot and sequence number, for reconnects and host handover. There is no server-side storage.

---

## 12. Roadmap: V1 in milestones

Everything above ships in V1. The milestones exist so the squad can dogfood early (from M2, the squad plays with it every week).

### M0: technical spikes (each with a go/no-go)
1. **GSI as a player** on FACEIT and Premier. Confirm the fields, the `map.mode` value, and latency. **Run `tools/gsi-probe` first.** It settles squad positions (section 3.7): is your own position sent while alive, and is the watched teammate's position sent while dead?
   - *Status:* done (2026-10-21, competitive de_dust2, 596 payloads). No position while alive (0/299) or while watching a teammate (0/180), and no `allplayers`. Squad markers stay planned spots, check-ins and rotations (section 3.7).
2. ~~**GSI to a remote HTTPS URL.**~~ Dropped: with no relay, there's nothing for a web member's CS2 to post to. Members share GSI through the desktop app.
3. **Premier roster** from `status` / `-condebug`.
   - *Status:* built as a paste (M9, 2026-10-22). csbot never reads the console or its log: the host types `status` in CS2's console and pastes what it prints on the Scout page. csbot reads the Steam IDs in any of the forms CS2 has printed (`[U:1:n]`, `STEAM_x:y:z`, 64-bit) and the quoted names. Still to check on one real Premier match: what today's CS2 prints. Measurement runs keep the pasted text next to the run's files to check it.
4. **FACEIT:** live match detection, plus applying for the Downloads API now (FACEIT quotes ~30 days).
   - *Status:* needs the owner's FACEIT developer account.
5. **Claude Code:** warm stream-json latency p50/p95, MCP from `claude -p`, usage per match on Pro vs Max.
   - **Done: go.** 3.1–5.4 s to screen with Sonnet (section 6.4, `tools/spikes/claude-latency`). Plan usage per match is still to measure.
6. **demoparser2** (Node binding) on FACEIT and Valve demos. Auto-build Mirage zones and routes.
   - *Status:* zones and routes no longer need demos. They come from the map files (`tools/map-build`, section 7.3). Demos are still needed to calibrate plan odds and timings, and for spike 9. HLTV's demo downloads sit behind a bot check, so demos have to be downloaded in a browser (the owner's own match first).
   - **Done: go.**
     - `@laihoe/demoparser2` (MIT) reads a 60 MB CS2 demo in about 0.3 s (`packages/demo`, tested on demoparser's own public test demo).
     - It gives money at the start of each round, the equipment value once bought, plant sites and every death with its position.
     - In the installed app it runs in a worker thread, with the native module unpacked next to the app archive.
7. **Peer-to-peer rooms:** a host plus 5 clients over WebRTC with Trystero signaling on public Nostr relays. Measure join time, latency, reconnects, and how often direct connection fails on the squad's real networks.
   - **Done on one PC: go.** 5/5 members joined through public Nostr relays in 0.5–1.1 s, and a wrong-key peer was refused (`tools/spikes/p2p-rooms`). Still to measure in M2: direct connection success between the squad's real home networks.
8. **Electron footprint** on a gaming PC (RAM/CPU during a match).
   - **Done: go,** with a hidden window: 268 MB private memory and 0.2% CPU while hosting (`tools/spikes/electron-footprint`). To re-measure with a visible window during a real match.
9. **Economy rules** checked against demo truth.
   - *Status:* partly done with a real GSI recording (competitive de_dust2, 2026-10-21, kept on the owner's PC only). Players never get `round_wins`. The half's last round ends in an `intermission` payload and the match's last in a `gameover` one. An exploded bomb is never reported. Each half starts at loss-bonus level 1, so a lost pistol round pays $1,900. The tracker now handles all four: 23 of 23 rounds are recorded with the right winner. Enemy money still needs demo truth.
   - *Status:* the tooling is done. Each debrief with a demo measures buy-read accuracy, money-band coverage and site-read accuracy (M6). Calibrating the economy model still needs the squad's own demos.

### Milestones
1. **M1 · Core host:** Electron shell, GSI server + recorder/replayer, engine (economy), Live (banner, tiles, scoreboard with host data).
2. **M2 · Rooms:** peer-to-peer rooms (WebRTC + Nostr signaling), protocol, E2E, invite/join/approve, roles and permissions, web app on GitHub Pages, member GSI sharing from the desktop app, personal YOU.
   - *Built:* everything except testing across real home networks with the squad, and the Pages deploy, which waits on the PR.
3. **M3 · Scouting:** FACEIT/Steam/Leetify clients + cache, Scout page, analyst session + MCP server.
   - *Built:* FACEIT and Steam clients, cache, Scout page, the AI briefing (structured output, no MCP needed), and encrypted key storage.
   - *Waiting:* real responses, once the owner adds keys.
   - *Deferred:* Leetify (optional), and automatic FACEIT match detection (spike 4).
4. **M4 · Forecast:** demo ingest, zones and routes for the map pool, plan priors, heat, intel from all members, gather mode.
   - *M4a, built:* intel from all members (map clicks, optional numpad hotkeys), and PLAN CHANGED with a mid-round call.
   - *M4b, built:* real maps for the whole pool (Ancient, Anubis, Cache, Dust II, Inferno, Mirage, Nuke), all generated from the CS2 map files. Each map has callout zones, timed routes, enemy plans with first-estimate odds by buy, and a CT playbook (anti-eco and default setups). Intel clicks work anywhere inside a zone.
   - *M4c, built:* the forecast on our T halves.
     - Each map has 5–6 typical enemy CT setups (standard, stack A, stack B, a map-specific push, light sites), with odds by their buy.
     - The map shows where defenders likely hold, and the tile says which site is likely light.
     - Intel is matched to how many defenders a setup puts on each site, so "4 on B" reads as a B stack.
     - When the read turns clear, PLAN CHANGED calls "A likely light · go A", and Claude is asked for its mid-round call as on CT.
   - *M4d, built:* the T-side playbook. Every map has T slot roles (entry, support, lurk, IGL, AWP) and five T setups: a default, an exec per site, an eco play and a force play, each with planned spots, a job per slot and the call.
     - At freeze time the engine picks by our money, and with a full buy goes toward the site their CT setup likely leaves light.
     - When intel shows a light site, the call switches to that site's exec and its jobs.
   - *Still to do:* calibrating odds and timings with demos.
5. **M5 · Live coach:** playbook, live session, per-player jobs, Coach page, voice, tournament mode, quotas.
   - *Built.* One warm session per match. Claude's call replaces the engine's on every screen.
   - *Measured through the app's own runner:* warm-up 2.2 s, round call 3.0 s (Sonnet, low effort), about $0.011 at API-equivalent prices for both.
   - *Memory:* the `claude` process uses about 224 MB, in addition to csbot's roughly 290 MB.
6. **M6 · Debrief:** analysis, calibration reports, progress tracking.
   - *Built:* every match a desktop app is open for is recorded from its own GSI and kept on that PC. Each round holds our buy, the enemy estimate, the forecast, the call, the intel and the player's own round.
   - **The Debrief page shows:**
     - the result
     - an HLTV 1.0-style rating
     - rounds won by side and by our buy
     - the enemy money estimate per round
     - a round-by-round table
     - progress across matches: rating trend, win rate by map
     - Claude's "work on next" (one call on the host's Claude plan)
   - **With the match demo** (added from the replays folder, a file picker, or drag and drop; .dem, .dem.gz, .dem.zst):
     - buy-read accuracy, money-band coverage and site-read accuracy
     - their real money next to the estimate
     - opening duels
     - where you died
     A demo of a match csbot wasn't open for is rebuilt from the demo alone, as long as your Steam ID is in it.
   - Room members get the host's debrief.
   - *Not built:* "calls followed" (it needs player positions at set times, which demos have) and a FACEIT demo download (Downloads API access).
7. **M7 · Extras:** 2D replay, lineup library, anti-strat builder, Stream Deck, push-to-talk, practice export, Wingman, Premier roster (if M0 passed).
   - *Built:*
     - **Gather mode** (section 3.6).
     - **2D round replay** on the Debrief page, from the match demo. Everyone's movement at 4 frames a second, kills, smokes, molotovs, flashes and the plant, on csbot's own map outline. It plays at 1×, 2× or 4× and scrubs with a slider. The replay is kept gzipped next to the match record, on that PC only. The browser demo shows a fictional one, labeled as such.
     - **Push-to-talk** (desktop, off by default): press the key (Num0 by default), then say one thing. "three B apps" logs intel and "palace clear" logs a clear. "on my spot" and "rotating A" check you in, and "coach, should we save this round" asks the coach.
       - Windows' own recognizer (System.Speech, run by Windows PowerShell) does the recognition offline. It listens only after the key, for one sentence, and nothing is recorded.
       - It listens for a fixed list of phrases built from the map's callouts, plus free speech after "coach".
       - A tone plays when it listens and another when it understood. The command is read back if voice callouts are on.
       - What it hears goes the same way as a click, so a member's intel and questions reach the room's host. Tournament mode refuses them the same way.
       - English only for now.
     - **Team playbook and anti-strats** (Playbook page). The room admin edits them in the desktop app, and they stay on that PC. The room shares them read-only, and every screen's engine runs on them.
       - *Our plays:* per map and side, rename setups and positions, choose which buys a setup answers (and the site a T exec hits), write the call and each position's job, and drag the planned spots on the map. Duplicate or delete setups, or reset the map to csbot's.
       - *Anti-strat* for a named opponent (by default the scouted one), per map:
         - how often they run each T plan and CT setup: never, less, usual, more or mostly
         - our CT setup against their eco, force and full buy
         - notes the coach also reads
         - a preview of how their site odds move
       - The anti-strat applies only while it's "in use". It scales csbot's own plan odds, so they stay estimates.
       - Saving updates the current freeze-time call right away.
     - **Lineup library and practice config** (Playbook → Lineups):
       - Each map starts with csbot's list of well-known smokes, molotovs and flashes for both sides. Each is a throw spot and a landing spot on the map, plus a technique, linked to the setups that use it. The call card lists the utility of the call's setup.
       - The team edits the list: drag either end, rename, pick the grenade and the setups, add or delete lineups. An exact spot can be pasted from their own practice server: they type `getpos` there themselves, and csbot never reads the console.
       - **Practice config:** a `csbot_<map>.cfg` for a private server. It sets up grenade practice (sv_cheats, infinite grenades, trajectory preview, buy anywhere) and adds one `lineupN` command per lineup. The command teleports you to the throw spot facing the landing spot, with the grenade in hand. Without an exact spot, the teleport uses the callout's floor height (now part of the map build) and says "near".
       - In the browser it's a download. The desktop app can also put it in CS2's cfg folder when you click.
     - **Wingman** (GSI mode `scrimcomp2v2`):
       - 8-round halves, 1:30 rounds and a 10 s freeze.
       - Two positions, Player 1 and Player 2, in the room and on the map.
       - Calls are about money. There's no site forecast: csbot's plans are for five players and two sites, and Wingman is two players on one site.
       - The coach is told it's Wingman.
       - Wingman maps csbot has no geometry for (Vertigo, Overpass…) show no map. Intel and markers work on the maps it has.
       - The browser demo plays one with `?mode=wingman`.
     - **Stream Deck plugin** (`apps/streamdeck`, attached to every release as `com.grovic.csbot.streamDeckPlugin`). It has four keys:
       - Intel: a lane of the current map, A side, mid or B side, with a count or "clear". The key shows the zone's name.
       - Check in
       - Push to talk
       - Team call: the buy read and the call
       - It talks to the desktop app's local control API. That API is off by default and listens on 127.0.0.1 only, with a new key each time it's turned on, written to `control.json` in csbot's data folder. It refuses browsers (any Origin header) and other host names.
       - Keys go the same way as a click, so a member's intel reaches the room's host. The toast confirms each one.
   - The Premier roster came in M9 (a pasted `status`).
8. **M8 · Hardening:** host handover, signing, auto-update, performance, closed beta with a few squads → **V1 release**.
   - *Done:*
     - The installer and auto-update: an unsigned per-user NSIS installer on GitHub Releases. v0.5.0 is published; pushing a `v*` tag releases.
     - A secret scan in CI.
   - *Done:* host handover and room expiry (section 3.8).
   - *Performance pass (2026-10-22):*
     - A 30-minute soak (`tools/spikes/electron-footprint`, hidden window, replayed match) found that drawing with the graphics card makes memory grow. The GPU process went from about 190 to 270 MB, and the total peaked at 412 MB, over the 400 MB budget. It grows on the Live page only: on Settings the GPU process stays flat around 105 MB.
     - What was tried:
       - Canvases drawn on the CPU: worse.
       - Chromium's GPU memory caps: no change.
       - The heat map turned off: still grows.
       - The map drawing on its own layer: it starts lower and grows half as fast. This change is kept.
     - **Low-memory mode is now the default** (Settings; it applies after a restart). csbot draws without the graphics card. Over the 30-minute soak it averaged 167 MB of private memory (peak 176) at 0.2% CPU, and the GPU process stayed flat at 21 MB. The page's own memory crept up about 8 MB over the half hour. The CPU is the same as with the graphics card. Turning it off draws with the graphics card again.
     - The web app's first download went from 929 KB to about 715 KB. The secondary pages load when first opened. The room protocol no longer needs zod, which now loads only with the demo's scouting sample.
     - Room reconnect after the host comes back is now tested against the 5 s criterion, over the tests' local signaling relay.
     - **The demo reader runs in its own process** (Electron's utility process). In a worker thread, the native parser crashed now and then under load, about 3 runs in 10 of the parallel test suite, and a crash there takes the whole app down. Now a crash only fails that try, which is retried once. 0 crashes in 10 runs after the change; checked in the packaged app too.
     - Numpad hotkey intel now goes through the page like a click. A member's hotkey intel used to land in their own PC's tracker; now it reaches the room's host.
   - *Decided:* the beta installer stays unsigned (2026-10-22). Azure Trusted Signing (about $10 a month) stays the option for later.
   - *Pending:* measurements that need the owner: a visible window during a real match, and the reconnect over real networks.
9. **M9 · Real-match kit (2026-10-22):** everything the first real match needs to settle the V1 criteria.
   - *Built:*
     - **The next round's call at round end**, with Claude asked then (section 6.4). The call card says "Next round", and the enemy buy and likely-hit tiles show the next round's estimate. Tournament mode hides it like the rest of the forecast.
     - **Measurement runs.** The playtest shortcut starts csbot with `--metrics`. Besides the per-second process metrics, it then logs the match's events: phase changes (a round ends when "over" starts), each new call on the host, Claude's time per call, the host's recent FACEIT matches, and the window's state. Each screen in the room reports each new call it shows (the room message `shown`), and the host notes members coming and going. All of it stays on the PC, next to the metrics in `%APPDATA%\csbot\metrics`.
     - **`tools/real-match`** turns one run into the V1 numbers: private memory and CPU while the match is on (and how long the window was on screen), the time from round end to the next round's call on every screen (the engine's and Claude's, p50/p95), Claude's own time and plan usage, room reconnects, and whether FACEIT listed the match while it was played.
     - **Premier roster from a pasted `status`** (spike 3). Each player's Steam profile and FACEIT account by Steam ID, when they have one and keys are saved. Valve's matchmaking doesn't say who's on which team. Our side starts with what csbot knows (this PC, teammates watched after dying, room members by name), and the host marks the others; once a team has five, the rest go to the other side. The briefing runs once the teams are sorted, and only when csbot found data on the players: names alone aren't enough to write from.

**V1 exit criteria:**
- buy-read accuracy ≥ 80% and money-band coverage ≥ 85% on 50 held-out demos
- call on every screen ≤ 8 s after round end (p95)
- under 3% CPU and 400 MB RAM on the host while in game (RAM = private memory summed over csbot's processes, as Task Manager shows it; the user's own `claude` process, about 220 MB while coaching, is counted separately)
- room reconnect in under 5 s

---

## 13. Risks and open decisions

| Risk | Mitigation |
|---|---|
| Valve changes GSI fields | Recorder corpus + contract tests. Fields and rules live in data files. |
| No positions while alive *and* none while dead (**confirmed** by the probe, 2026-10-21) | Squad markers rely on planned spots, check-ins, and rotation timing. Exact positions come in the post-match replay. |
| No Premier roster source | FACEIT-first. Premier: the host pastes the console's `status` (M9), plus room members and post-match learning. |
| Anthropic terms or plan usage change | Per-match budgets and member quotas. API-key mode on the same code path. |
| Direct connection fails on strict networks | Same-LAN and most home networks connect directly. Fallbacks: the host forwards traffic when its router allows UPnP, or the squad runs open-source coturn. M2 measures the failure rate. |
| Public Nostr relays go down or rate-limit | Several relays at once. Trystero can also signal over BitTorrent trackers or MQTT. Signaling is a handful of messages per join. |
| Host PC drops mid-match | Every member keeps the last snapshot; another desktop member takes over |
| League rules on live assistance | Room-wide tournament mode |
| Model makes things up | Tool-only facts, playbook-bound calls, eval set from votes |
| Map art licensing | Our own outlines traced from the nav mesh (walkable floor) and callout volumes. No Valve radar images. |

**Decisions needed:**
1. **Repo and hosting owner:** GitHub org or account for Pages and Releases (e.g. `csbot-app`), and whether the repo is public from day one.
2. ~~**Code signing:** buy a certificate (Azure Trusted Signing is the cheapest route), or ship unsigned during the beta.~~ Decided 2026-10-22: unsigned during the beta.
3. **Member question quota** default (5 per match?), and whether randoms can get a read-only invite.

---

## Sources
- Valve: [CS:GO/CS2 Game State Integration](https://developer.valvesoftware.com/wiki/Counter-Strike:_Global_Offensive_Game_State_Integration) (spectator-only `allplayers_*`, positions, grenades)
- [CounterStrike2GSI](https://github.com/antonpup/CounterStrike2GSI) README (local player only while playing; node and field list)
- Claude Code: [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) · [CLI reference](https://code.claude.com/docs/en/cli-reference) · [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- Anthropic support: [Use the Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) (separate credit paused)
- FACEIT: [Downloads API](https://docs.faceit.com/getting-started/Guides/download-api) · [FACEIT Anti-cheat](https://support.faceit.com/hc/en-us/articles/9394666828188)
- Leetify public API: [Rust client docs](https://docs.rs/crate/leetify/0.1.1)
- CS2 `status` command: [csdb.gg](https://csdb.gg/command/status/) (the SteamID form today's CS2 prints is still to confirm, see spike 3)
- CS2 economy summaries: [csdb.gg economy guide](https://csdb.gg/economy-guide) · [Refrag](https://refrag.gg/blog/cs2-economy-crash-course-what-are-kill-rewards-and-loss-bonus) (values to verify against demos)
