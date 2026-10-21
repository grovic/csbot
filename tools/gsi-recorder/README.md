# gsi-recorder

A standalone CS2 GSI listener that writes every payload to NDJSON (`{"t": epochMs, "p": payload}` per line), the same format the desktop app's recorder and the GSI probe use. It's for capturing raw feeds without the app running.

The `auth` token is redacted in the file. Recordings still contain Steam IDs and names, so they stay local: `*.ndjson` is gitignored. Run `anonymize()` from `@csbot/gsi` before turning one into a test fixture.

```sh
node tools/gsi-recorder/src/record.ts --token <8-128 chars> [--port 47401] [--out match.ndjson] [--duration SECONDS]
```

- On start it prints the GSI cfg text that points CS2 at the recorder.
- On Ctrl+C, or after `--duration`, it prints a summary: payloads, size, maps, rounds seen, and phases.
- Port 47399 belongs to the GSI probe and is refused.

Replay a recording with [`gsi-replayer`](../gsi-replayer/README.md).
