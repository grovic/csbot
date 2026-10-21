// Room codes, keys and invite links.
// Invite: https://grovic.github.io/csbot/#/r/K7P2QX?k=<key>. Everything after '#' stays on the device:
// browsers never send the fragment to any server.

/** Crockford-style alphabet without look-alikes (no I, L, O, U, 0, 1). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
export const CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const KEY_RE = /^[A-Za-z0-9_-]{22,64}$/;

export const DEFAULT_INVITE_BASE = 'https://grovic.github.io/csbot/';

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function newRoomCode(): string {
  let out = '';
  // Rejection sampling keeps the distribution uniform.
  while (out.length < CODE_LENGTH) {
    for (const x of randomBytes(16)) {
      if (x < 240 && out.length < CODE_LENGTH) out += CODE_ALPHABET[x % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** 128-bit room key, base64url. */
export function newRoomKey(): string {
  let s = '';
  for (const x of randomBytes(16)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Random id for this device (members keep it in localStorage, so reconnects are recognized). */
export function newClientId(): string {
  return newRoomKey().slice(0, 16);
}

export const isRoomCode = (c: string) => CODE_RE.test(c);
export const isRoomKey = (k: string) => KEY_RE.test(k);
/** Show codes as K7P-2QX. */
export const formatCode = (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`;
/** Accept K7P-2QX, k7p2qx, " K7P 2QX ". */
export const normalizeCode = (c: string) => c.toUpperCase().replace(/[\s-]/g, '');

export interface Invite { code: string; key: string }

export function inviteUrl(base: string, inv: Invite): string {
  const b = base.endsWith('/') ? base : base + '/';
  return `${b}#/r/${inv.code}?k=${inv.key}`;
}

/**
 * Read an invite from a full link, a bare hash ("#/r/CODE?k=KEY") or a hash route ("/r/CODE?k=KEY").
 * Returns undefined for anything malformed.
 */
export function parseInvite(input: string): Invite | undefined {
  const s = input.trim();
  const hash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
  const m = /^\/?r\/([A-Za-z0-9-]+)\?(.*)$/.exec(hash);
  if (!m) return undefined;
  const code = normalizeCode(m[1]!);
  const key = new URLSearchParams(m[2]).get('k') ?? '';
  return isRoomCode(code) && isRoomKey(key) ? { code, key } : undefined;
}
