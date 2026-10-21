# GSI probe: can the room show teammates' positions?

A 10-minute test that decides how the squad-positions feature works. It answers three questions:

1. Does CS2 send **your own position** while you're alive? If yes, room members can share their live position.
2. Does it send **the teammate you're watching** while you're dead? If yes, dead room members become live spotters.
3. Does `allplayers` ever show up while you're playing or dead? If yes, the room-wide spectator guard must drop it.

The probe listens on `127.0.0.1` only, never sends anything anywhere, and needs Node 18+.

**Who does what:** the agent installs the config, starts and stops the listener, reads the results, and removes everything afterwards. The owner only plays (see AGENTS.md). The steps below are what happens during a run.

## Test 1: offline with bots (required)

1. Copy `gamestate_integration_csbot_probe.cfg` to
   `C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\`
   (or the same folder in your Steam library).
2. Run `node tools/gsi-probe/probe.mjs`.
3. Start CS2: **Play → Practice → Competitive**, with bots, on Mirage.
4. Play **one round alive** for at least 30 seconds and move around.
5. **Die** (let a bot kill you), then **watch a teammate bot** for at least 30 seconds. Switch between two teammates.
6. Optional: open the team menu and pick **Spectate** for 20 seconds.
7. Press **Ctrl+C** in the probe window and paste the results block back to the team.

This config also asks for `allplayers_*`, only to see what the game sends. Use it offline only.

## Test 2: one real match (recommended)

The same steps in one real Premier or FACEIT match confirm the live-server behavior. **Swap the config** first: delete the offline one and copy `gamestate_integration_csbot_probe_match.cfg`. It asks only for your own player data, nothing spectator-only. Check that it shows up under the expected situations, then remove it after the match.

## Reading the verdict

| Result | What we build |
|---|---|
| 1 = YES | Every room member who shares GSI shows as a live dot. Randoms show their planned spot. |
| 1 = NO, 2 = YES | Planned spots + one-key check-ins, plus live dots for teammates a dead room member is watching |
| 1 = NO, 2 = NO | Planned spots + check-ins only. Exact positions come in the post-match replay. |
| 3 = PRESENT | Nothing changes in the product, but the guard test becomes a release blocker |

Only one probe config should be in the `cfg` folder at a time. Remove it when you're done.
