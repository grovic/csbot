// The fictional room shown with the browser demo, so slot names on the map and the room chip work.

import { slotsFor } from '@csbot/engine';
import { DEFAULT_PERMISSIONS, type RoomView } from '@csbot/protocol';

export function demoRoom(map?: string): RoomView {
  return {
    code: 'K7P2QX',
    hostName: 'rdx',
    members: [
      { id: 'host', name: 'rdx', role: 'admin', device: 'host', online: true, sharesGsi: true, slot: 'a' },
      { id: 'demo-kairo', name: 'kairo', role: 'member', device: 'desktop', online: true, sharesGsi: true, slot: 'short' },
      { id: 'demo-nyx', name: 'nyx', role: 'member', device: 'web', online: true, sharesGsi: false, slot: 'b' },
      { id: 'demo-mbt', name: 'mbt', role: 'member', device: 'desktop', online: true, sharesGsi: true, slot: 'rotator' },
      { id: 'demo-zeph', name: 'zeph', role: 'member', device: 'web', online: false, sharesGsi: false, slot: 'awp' },
    ],
    pending: [],
    permissions: { ...DEFAULT_PERMISSIONS },
    tournament: false,
    slots: slotsFor(map ?? 'de_mirage').map(s => ({ ...s })),
    you: 'host',
    createdAt: Date.UTC(2026, 9, 21, 20, 0, 0),
  };
}
