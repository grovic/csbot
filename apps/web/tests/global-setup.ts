// A local signaling relay for the room tests, so they never depend on public Nostr relays.
import { startRoomRelay } from '@csbot/room-relay';

export default async function globalSetup() {
  const relay = await startRoomRelay();
  process.env.CSBOT_RELAY = relay.url;
  return async () => { await relay.close(); };
}
