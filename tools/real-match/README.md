# Real-match report

The V1 numbers from one real match, played with csbot started with `--metrics` (the playtest shortcut does that).

```
node tools/real-match/src/report.ts                # the latest run in %APPDATA%\csbot\metrics
node tools/real-match/src/report.ts --session 2026-10-23_210512 --dir <folder>
```

A measurement run writes two files in `%APPDATA%\csbot\metrics`:
- `<session>.ndjson`: every csbot process's memory and CPU, once a second.
- `<session>.events.ndjson`: the match's events.
  - Phase changes (a round ends when "over" starts) and each new call on the host.
  - Each screen in the room reporting the calls it shows (the host's own, and every member's through the room).
  - Members coming and going, Claude's time per call, the host's recent FACEIT matches, and the window's state.

The report prints, per match:
- **Memory and CPU** while the match is on: private memory summed over csbot's processes, and CPU across the whole machine. V1: under 400 MB and 3%. It also shows how much of the match the window was on screen.
- **Calls:** for each round end, how long until every screen showed the next round's call, from the engine and from Claude (p50/p95). V1: p95 ≤ 8 s. Round ends before a half's first round don't count, because the sides swap and the call waits for freeze time.
- **Coach:** Claude's own time per call, and plan usage at API prices.
- **Room:** each member's reconnects. V1: under 5 s.
- **FACEIT:** whether the match showed up as live in the host's recent matches while it was played.

It also writes `<session>.report.json` next to the files. Everything stays on the PC: it has member names and match IDs.
