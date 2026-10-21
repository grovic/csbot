# Spike 8: Electron footprint on the gaming PC (M0)

**Question:** can the Electron host stay light enough to run next to CS2? The V1 exit criteria are under 400 MB of RAM and under 3% CPU while hosting a match.

**Answer: yes, with a caveat on how memory is counted.** While hosting, the app uses about 270 MB of private memory and 0.2% CPU. That passes both criteria. The sum of per-process working sets is about 440 MB, but it counts shared DLL pages once per process, so it overstates the real footprint. The V1 criterion should be defined on private memory, which matches Task Manager's "Memory" column.

## How it runs

```sh
node apps/desktop/build.mjs && pnpm --filter @csbot/web build
node tools/spikes/electron-footprint/measure.mjs [--idle 15] [--duration 120] [--speed 1] [--tick 0.25]
```

1. The script launches the built app with `CSBOT_HIDDEN=1`, a temp user data dir, a random GSI port, and `CSBOT_METRICS_FILE`. With that env var set, the main process writes `app.getAppMetrics()` once per second.
2. The app idles for 15 s on the "waiting for CS2" screen.
3. `tools/gsi-replayer` posts the full synthetic match over HTTP for 120 s, at real-time spacing: about 4 payloads/s in freeze time and 1/s while the round is live.
4. The script computes the results and writes them to `results.json`.

**How CPU is counted:** from each process's cumulative CPU seconds. Electron's `percentCPUUsage` came out already divided by the core count on this machine, so it isn't used.

## Results (2026-10-21, Electron 45.0.0, 16 logical cores, Windows 11)

| | Idle (waiting for CS2) | Hosting a match |
|---|---|---|
| Private memory, avg / peak | 157 / 159 MB | **268 / 278 MB** |
| Working set (sum), avg / peak | 395 / 397 MB | 437 / 443 MB |
| CPU, machine-wide, avg / 1 s peak | 0.1 / 0.2 % | **0.2 / 0.7 %** |
| CPU, one core, avg | 2.4 % | 3.4 % |
| Payloads received | none | 247 (2.1/s) |

Per process while hosting (private memory / working set / CPU seconds over 120 s):

| Process | Private | Working set | CPU |
|---|---|---|---|
| Browser (main: GSI server, tracker, IPC) | 69 MB | 118 MB | 0.86 s |
| GPU | 146 MB | 131 MB | 1.93 s |
| Tab (renderer: React UI, heat canvas) | 40 MB | 114 MB | 1.16 s |
| Utility (network service) | 13 MB | 75 MB | 0.00 s |

Leftover processes after the run: none.

## Takeaways

- **CPU isn't a concern:** 0.2% of the machine on average and 0.7% at peak. The main process handles each payload in well under a millisecond.
- **The GPU process is the largest consumer** (146 MB private), even with a hidden window. If memory gets tight, `app.disableHardwareAcceleration()` would remove most of it in exchange for more renderer CPU. Measure that trade-off with a visible window before deciding.
- **Memory grows from 157 to about 270 MB** once a match is rendering (map, heat canvas, scoreboard). 120 s is too short to rule out a slow leak, so run a 30-minute soak (`--duration 1800`) before M8.

## Caveats (not verified yet)

- **Hidden window.** There's no on-screen compositing or vsync-driven painting, so GPU and renderer costs will be higher with a visible window on a 144 Hz second screen. Re-measure with the window visible during a real match. That needs the owner, and it needs to be scheduled so it doesn't disturb a game.
- **Synthetic feed.** Real CS2 cadence depends on the cfg's `throttle`/`buffer` and on what changes. The synthetic stream sends 4 payloads/s at most, which is about the cfg's upper bound.
- **Cores.** Machine-wide CPU % depends on the core count. On a 4-core PC the same load would read about 0.9% average.
