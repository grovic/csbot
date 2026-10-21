# gsi-replayer

Posts a GSI recording, or a synthetic fictional match, to a GSI endpoint over HTTP. Payloads go out with the recorded spacing, so the desktop app sees exactly what it would see from CS2. Use it for development, tests, screenshots and measurements without a live match.

It runs with plain Node 24, which strips TypeScript types natively. There's no build step.

## Examples

```sh
# Feed the running desktop app. It writes its URL and token to runtime.json in its userData folder.
node tools/gsi-replayer/src/replay.ts --synthetic=full --runtime "%APPDATA%/@csbot/desktop/runtime.json"

# Half a match, without round_wins/phase_countdowns (what a playing client probably gets), at 5x
node tools/gsi-replayer/src/replay.ts --synthetic --lean --url http://127.0.0.1:47400 --token <token> --speed 5

# Real-time cadence (~4 payloads/s in freeze time), looping until Ctrl+C
node tools/gsi-replayer/src/replay.ts --synthetic=full --tick 0.25 --runtime <userData>/runtime.json --loop

# A recording (desktop app: <userData>/recordings/*.ndjson, or gsi-recorder output), from payload 300, as fast as possible
node tools/gsi-replayer/src/replay.ts rec.ndjson --runtime <userData>/runtime.json --from 300 --speed 0
```

## Options

| Option | Meaning |
|---|---|
| `--synthetic[=half\|full]` | Fictional match: `half` is 12 rounds, `full` is 21 rounds (13–8). |
| `--lean` | Synthetic only: leave out `map.round_wins` and `phase_countdowns`. |
| `--tick N` | Synthetic only: seconds between freeze-time payloads (default 2). |
| `--speed N` | `1` keeps the recorded spacing, `0` sends as fast as possible. |
| `--from N` | Start at payload index N. |
| `--loop` | Start over at the end. |
| `--quiet` | Print only the summary. |

## Notes

- The `auth.token` of every payload is replaced with the target's token.
- Looping restarts the round numbers, so the desktop tracker treats each loop as a new match.
