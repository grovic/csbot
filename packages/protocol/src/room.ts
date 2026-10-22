// Room wire format. Rooms are peer-to-peer (PROPOSAL §3.4b): members connect straight to the host
// over WebRTC. Every message is JSON on one data channel. Anything a peer sends is validated here
// before use: peers are squad members, but a malformed message must never crash the host.

import type { LiveSnapshot } from './index.ts';
import type { DebriefView } from './debrief.ts';
import type { ScoutView } from './scout.ts';
import type { CoachView } from './coach.ts';
import type { TeamPlan } from './team.ts';

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
  /** A desktop member may take over hosting when the host's PC drops. */
  handover: boolean;
}

export const DEFAULT_PERMISSIONS: RoomPermissions = { intel: true, ask: true, editSlot: true, handover: true };

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
  /** Gather mode: the match's randoms in the slots nobody in the room plays (from scouting). */
  randoms?: { slot: string; name: string }[];
  /** Hosting generation: 0 for the room's creator, +1 at each handover. Members follow the newest. */
  epoch?: number;
  /** The host device's client id, so a takeover can let the old host back in without asking. */
  hostClientId?: string;
  /** When the room expires without activity (epoch ms). */
  expiresAt?: number;
}

/** How this screen is connected to its room. */
export type LinkStatus = 'connecting' | 'pending' | 'approved' | 'denied' | 'host-offline' | 'removed' | 'ended';

/** Everything one screen renders. Solo: just `live`. In a room: the host's personalized view. */
export interface ScreenState {
  live: LiveSnapshot;
  room?: RoomView;
  /** Pre-match scouting (from the host in a room, or this PC when solo). */
  scout?: ScoutView;
  /** The live coach: chat, call log, budget (from the host). */
  coach?: CoachView;
  /** The post-match debrief (from the host in a room, or this PC). */
  debrief?: DebriefView;
  /** The squad's playbook and anti-strats (the host's, read-only for members). */
  team?: TeamPlan;
  link?: { status: LinkStatus; since: number; detail?: string };
}

// ------------------------------------------------------------------ messages

/** Member → host. The host checks every one with parseMemberMessage (members aren't trusted). */
export type MemberMessage =
  | { t: 'hello'; v: number; clientId: string; name: string; device: 'desktop' | 'web' }
  /** The member's own GSI payload (desktop members). The host runs the spectator guard on it. */
  | { t: 'gsi'; payload: Record<string, unknown> }
  /** The member picks their own slot (when permitted). */
  | { t: 'slot'; slot: string | null }
  | { t: 'rename'; name: string }
  /** Intel: a zone and how many enemies were seen there (0 = clear). The host checks the intel permission. */
  | { t: 'intel'; zone: string; count: number }
  /** Squad check-in for the member's own slot: on my spot, or rotating to a site. */
  | { t: 'checkin'; state: 'spot' | 'rotate'; site?: 'A' | 'B' }
  /** A host with an older epoch is still sending: hosting moved (handover), so it should step down. */
  | { t: 'stale'; epoch: number }
  /** A question for the coach (the host checks the ask permission and the member's quota). */
  | { t: 'ask'; text: string }
  | { t: 'bye' };

const isInt = (v: unknown, lo = -Infinity, hi = Infinity): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const CLIENT_ID = /^[A-Za-z0-9_-]{4,64}$/;
const ZONE = /^[a-z0-9_]{1,32}$/;
/** A display name: trimmed, 1 to 24 characters. */
const nameOf = (v: unknown): string | undefined => { if (typeof v !== 'string') return undefined; const n = v.trim(); return n.length >= 1 && n.length <= 24 ? n : undefined; };

/** Host → member. Not schema-validated in depth (the host is trusted by its members), only by type. */
export type HostMessage =
  | { t: 'welcome'; v: number; status: 'pending' | 'approved' | 'denied' | 'full' | 'version'; detail?: string; epoch?: number }
  | { t: 'state'; room: RoomView; live: LiveSnapshot; epoch?: number }
  /** Sent on join and whenever scouting changes (too big to ride along with every state). */
  | { t: 'scout'; scout: ScoutView }
  /** Sent on join and whenever the debrief changes (a match ends, a demo or Claude's notes arrive). */
  | { t: 'debrief'; debrief: DebriefView }
  | { t: 'team'; team: TeamPlan }
  /** Sent on join and whenever the coach changes (chat, call log, budget). */
  | { t: 'coach'; coach: CoachView }
  /** The answer to this member's own ask: refused (quota, permission) or accepted. */
  | { t: 'askResult'; ok: boolean; error?: string }
  /** Refused intel (permission, tournament, not a live round). Accepted intel shows up in the next state. */
  | { t: 'intelResult'; ok: boolean; error?: string }
  | { t: 'removed'; reason: string }
  | { t: 'ended' };

const HOST_TYPES = new Set(['team', 'debrief', 'welcome', 'state', 'scout', 'coach', 'askResult', 'intelResult', 'removed', 'ended']);
export function isHostMessage(m: unknown): m is HostMessage {
  return !!m && typeof m === 'object' && HOST_TYPES.has((m as { t?: unknown }).t as string);
}

/** A member's message, rebuilt from known fields only (anything else is dropped), or undefined. */
export function parseMemberMessage(m: unknown): MemberMessage | undefined {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hello': {
      const name = nameOf(o.name);
      if (!isInt(o.v) || typeof o.clientId !== 'string' || !CLIENT_ID.test(o.clientId) || !name || (o.device !== 'desktop' && o.device !== 'web')) return undefined;
      return { t: 'hello', v: o.v, clientId: o.clientId, name, device: o.device };
    }
    case 'gsi':
      return o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload) ? { t: 'gsi', payload: o.payload as Record<string, unknown> } : undefined;
    case 'slot':
      return o.slot === null || (typeof o.slot === 'string' && o.slot.length <= 24) ? { t: 'slot', slot: o.slot } : undefined;
    case 'rename': {
      const name = nameOf(o.name);
      return name ? { t: 'rename', name } : undefined;
    }
    case 'intel':
      return typeof o.zone === 'string' && ZONE.test(o.zone) && isInt(o.count, 0, 5) ? { t: 'intel', zone: o.zone, count: o.count } : undefined;
    case 'checkin':
      if (o.state !== 'spot' && o.state !== 'rotate') return undefined;
      if (o.site !== undefined && o.site !== 'A' && o.site !== 'B') return undefined;
      return { t: 'checkin', state: o.state, ...(o.site ? { site: o.site } : {}) };
    case 'stale':
      return isInt(o.epoch, 0, 1_000_000) ? { t: 'stale', epoch: o.epoch } : undefined;
    case 'ask': {
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      return text.length >= 2 && text.length <= 300 ? { t: 'ask', text } : undefined;
    }
    case 'bye':
      return { t: 'bye' };
    default:
      return undefined;
  }
}
