# csbot for Stream Deck

Stream Deck keys for csbot:

- **Intel**: enemies seen in a lane of the current map (A side, mid, B side), or the lane clear. The key shows the zone's name on the current map.
- **Check in**: your squad marker, either on my spot or rotating to A or B.
- **Push to talk**: csbot's push-to-talk. Turn push-to-talk on in csbot first.
- **Team call**: shows the enemy buy read and the team call.

## Install

1. In csbot (desktop app), open Settings and turn on **Stream Deck**.
2. Download `com.grovic.csbot.streamDeckPlugin` from the [latest release](https://github.com/grovic/csbot/releases/latest) and open it. The Stream Deck app adds the plugin.
3. Drag the csbot actions onto keys.

## How it talks to csbot

While Stream Deck is on, csbot runs a small API on `127.0.0.1` with a new key each time. It writes
the address and key to `%APPDATA%\csbot\control.json`, and the plugin reads that file. Nothing leaves
the PC. The keys act on csbot only, never on the game.

## Develop

```
pnpm --filter @csbot/streamdeck build   # bundles bin/plugin.js and packs dist/com.grovic.csbot.streamDeckPlugin
pnpm --filter @csbot/streamdeck test    # a fake Stream Deck and a fake csbot drive the built plugin
node apps/streamdeck/scripts/icons.mjs  # re-renders the PNG images from their SVG (headless Edge)
```

The plugin speaks the Stream Deck WebSocket protocol directly, with `ws` bundled in. It needs no SDK
tooling and no Elgato account.
