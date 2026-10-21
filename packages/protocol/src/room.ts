// Room wire format. Rooms are peer-to-peer (PROPOSAL §3.4b): members connect straight to the host
// over WebRTC. Every message is JSON on one data channel. Anything a peer sends is validated here
// before use: peers are squad members, but a malformed message must never crash the host.

import { z } from 'zod';
import type { LiveSnapshot } from './index.ts';

export const ROOM_PROTOCOL = 1;
/** Hard cap on one message (a snapshot is a few KB; a GSI payload under 20 KB). */
export const MAX_MESSAGE_BYTES = 256 * 1024;

export type DeviceKind = 'host' | 'desktop' | 'web';
export type RoomRole = 'admin' | 'member';

export interface RoomPermissions {
  /** Members may log intel (M4). */
  intel: boolean;
  /** Members may ask the coach, within their quota (M5). */
  ask: boolean;
  /** Members may pick their own slot (position) instead of the admin assigning it. */
  editSlot: boolean;
}

export const DEFAULT_PERMISSIONS: RoomPermissions = { intel: true, ask: true, editSlot: true };

export interface RoomMember {
  /** Stable per device (the member's clientId); the host's own entry uses 'host'. */
  id: string;
  name: string;
  role: RoomRole;
  device: DeviceKind;
  online: boolean;
  /** The member's desktop app forwards their own GSI to the host. */
  sharesGsi: boolean;
  /** Playbook slot (e.g. 'a', 'b', 'awp'): their job in every call, their marker on the map. */
  slot?: string;
}

export interface JoinRequest { id: string; name: string; device: DeviceKind; at: number }

export interface SlotInfo { id: string; label: string }

export interface RoomView {
  code: string;
  hostName: string;
  members: RoomMember[];
  /** Waiting for the admin. Only sent to the host's own screen. */
  pending: JoinRequest[];
  permissions: RoomPermissions;
  /** Room-wide: live coaching off for everyone. */
  tournament: boolean;
  /** Slots the current map's playbook defines. */
  slots: SlotInfo[];
  /** Which member this view is for. */
  you: string;
  createdAt: number;
}

/** How this screen is connected to its room. */
export type LinkStatus = 'connecting' | 'pending' | 'approved' | 'denied' | 'host-offline' | 'removed' | 'ended';

/** Everything one screen renders. Solo: just `live`. In a room: the host's personalized view. */
export interface ScreenState {
  live: LiveSnapshot;
  room?: RoomView;
  link?: { status: LinkStatus; since: number; detail?: string };
}

// ------------------------------------------------------------------ messages

const id = z.string().min(4).max(64).regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(24);

/** Member → host. */
export const MemberMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: z.number().int(), clientId: id, name, device: z.enum(['desktop', 'web']) }),
  /** The member's own GSI payload (desktop members). The host runs the spectator guard on it. */
  z.object({ t: z.literal('gsi'), payload: z.record(z.string(), z.unknown()) }),
  /** The member picks their own slot (when permitted). */
  z.object({ t: z.literal('slot'), slot: z.string().max(24).nullable() }),
  z.object({ t: z.literal('rename'), name }),
  z.object({ t: z.literal('bye') }),
]);
export type MemberMessage = z.infer<typeof MemberMessage>;

/** Host → member. Not schema-validated in depth (the host is trusted by its members), only by type. */
export type HostMessage =
  | { t: 'welcome'; v: number; status: 'pending' | 'approved' | 'denied' | 'full' | 'version'; detail?: string }
  | { t: 'state'; room: RoomView; live: LiveSnapshot }
  | { t: 'removed'; reason: string }
  | { t: 'ended' };

const HOST_TYPES = new Set(['welcome', 'state', 'removed', 'ended']);
export function isHostMessage(m: unknown): m is HostMessage {
  return !!m && typeof m === 'object' && HOST_TYPES.has((m as { t?: unknown }).t as string);
}

export function parseMemberMessage(m: unknown): MemberMessage | undefined {
  const r = MemberMessage.safeParse(m);
  return r.success ? r.data : undefined;
}
