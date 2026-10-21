# Spike 7: peer-to-peer rooms, no server, no accounts (M0)

**Question:** can squad members join the host's room with nothing but an invite link? That means no relay server, nobody creating an account anywhere, and nothing to pay.

**Answer: yes, on this PC.** A host and 5 members connected through public Nostr relays in 0.5–1.1 s, and room updates flowed directly over WebRTC. A peer with the wrong room key was refused. One open question remains: how often direct connections fail between *different* home networks. That needs the squad, and it's the first test in M2.

## How it runs

```sh
node tools/spikes/p2p-rooms/run.mjs [members=5]
```

**Setup:**
- `src/peer.ts` runs in a browser page as the host or as a member.
- It uses [Trystero](https://github.com/dmotz/trystero) (MIT) with its default strategy: public Nostr relays carry the WebRTC handshake, and the data then flows peer to peer.
- The handshake offers are encrypted with the room key, which comes from the invite link's `#` part in the product.

**Star topology:**
- Trystero's `onPeerHandshake` exchanges roles.
- The host accepts members only, and members accept the host only.

**The run:**
- `run.mjs` opens the host and 5 members in headless Edge, each in its own browser context, like separate devices.
- An intruder joins too, with the wrong key.
- The host broadcasts a 2 KB update every 250 ms, a realistic room patch.
- Each member sends 20 pings, and one member reloads to test reconnecting.

## Results (2026-10-21, Trystero 0.26.0, default Nostr relays)

| | Result |
|---|---|
| Members connected | **5 / 5**, all through the host (star) |
| Host found (from page load) | 0.5–1.1 s |
| First room update | 0.65–1.25 s |
| Update latency, p50 / p95 | 4–16 / 24–151 ms (all six browsers share one PC) |
| Ping round trip, p50 | 1–89 ms (same caveat) |
| Wrong-key peer | refused: "incorrect room password when decrypting offer" |
| Reconnect after a member reloads | 0.5 s |
| Accounts or servers needed | none |

## What this settles

- **Signaling over public Nostr relays works:** no sign-up, and fast enough that joining feels instant.
- **The room key protects the room:** without it, a peer can't even complete the handshake.
- **The handshake hook gives the host admission control.** That's where admin approval goes in M2.
- **The same code runs in Electron's renderer,** which is Chromium. So the desktop host needs no native networking module.

## Not settled yet

- **NAT traversal between real homes.** Every peer ran on this PC, so connections were local. The STUN-only success rate between the squad's actual networks gets measured in M2, with each member opening a link. Strict networks need a TURN fallback, described in PROPOSAL §3.4b.
- **Relay availability over time.** Public Nostr relays can go down or rate-limit. Trystero uses several at once; M2 adds a health check and a fallback strategy.
- **Battery and network use on phones.**
