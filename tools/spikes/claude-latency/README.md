# Spike 5: Claude Code latency and MCP (M0)

**Question:** can one warm `claude -p` session, driven by game events, put a round call on every screen fast enough (target: ≤ 8 s p95 after the event), using only the user's own Claude Code login?

**Answer: yes.** Sonnet puts the call on screen in 3.1–5.4 s, Haiku in 2.6–3.3 s. Sonnet is the default for live calls because Haiku's calls had tactical mistakes.

## How it runs

`run.mjs` spawns the user's own `claude` binary once per match and keeps it warm:

```
claude -p --input-format stream-json --output-format stream-json --verbose
  --model sonnet --effort low --system-prompt-file system.md
  --mcp-config mcp.json --strict-mcp-config
  --tools "" --allowedTools "mcp__csbot__*" --permission-mode dontAsk --no-session-persistence
```

- Each game event is one user message on stdin.
- The model answers by calling the `publish_call` MCP tool (`mcp-server.mjs`, stdio). The moment that tool runs is "call on screen".
- `--tools ""` turns off every built-in tool, so the session can only publish calls.
- There is no `--bare` flag, so the subscription login is used.
- In stream-json input mode the session only starts after the first message is sent. The runner must not wait for `init` first.

Run it with `node run.mjs haiku,sonnet live`. The fictional squad is rdx, kairo, nyx, mbt, plus zeph, a random teammate.

## Results (2026-10-21, 3 calls per model per variant)

**v2, the live path:** facts in the prompt, no state tool, loose schema, and a warm-up turn at match start (`results-live.json`).

| Event | Haiku: on screen | Sonnet: on screen | Sonnet: turn done |
|---|---|---|---|
| R9 freeze (eco read) | 2.6 s | 3.8 s | 5.8 s |
| R9 live intel (3 at B apps) | 3.3 s | 5.4 s | 9.4 s |
| R10 freeze (full-buy read) | 2.8 s | 3.1 s | 3.9 s |

- **Startup:** session init takes 1.2–1.5 s. The warm-up turn takes 4–5 s, at match start when nobody is waiting.
- **Publishing:** every call was published exactly once, with no retries.

**v1:** strict schema plus a `get_match_state` tool (`results.json`). It was slower for two reasons:
- Haiku hit `maxLength` limits and retried three times (5.7 s to screen, 10 s turn).
- Sonnet fetched match state even though the facts were in the prompt (11.6 s to screen).

## Call quality

| | Haiku | Sonnet |
|---|---|---|
| Side logic | Gave CT players T-side jobs ("hit B site and pressure it") | Coherent CT setups |
| Random teammate | Left zeph with "no assignment" | Gave zeph a spot |
| Instruction following | Ignored "rdx is the A player" in one call | Followed it |

## Design rules this spike sets (M5 live coach)

1. **No length limits in the tool schema.** Describe the limits and trim server-side. A schema rejection costs a retry, which is seconds.
2. **Facts go in the event message.** Don't offer a state tool on the live path. The analyst and debrief sessions can have one.
3. **Send a warm-up turn at match start,** so the prompt cache is written before the first real call.
4. **The engine's template call shows instantly** (0 s) and the Claude call replaces it when it lands. A slow or failed call never leaves the screen empty.
5. **Default to Sonnet at low effort** for live calls. Haiku is a "fast" option in Coach config.
6. **Keep the setup from the playbook.** The engine picks the setup; the model adapts it and words the jobs. This avoids the inconsistency both models showed when the event left a setup open.

## Usage

- **Cost reporting:** `total_cost_usd` in stream-json is cumulative per session, so read the last value, not the sum.
- **This run:** about $0.026 at API-equivalent prices for 8 Sonnet + Haiku turns. On a claude.ai plan this counts against plan limits and isn't billed.
- **Per call:** a Sonnet call adds about $0.005–0.006 at this prompt size. At roughly 2 calls per round, a 24-round match is about $0.25–0.30 equivalent, before the per-match budget.

## Not settled yet

- **Sample size:** with 3 calls per model, the "p95" isn't statistically meaningful. Re-measure in M5 with the real prompts and 2 full matches.
- **Plan limits:** usage per match on Pro vs Max hasn't been measured. It depends on the owner's plan and on the rolling limits.
