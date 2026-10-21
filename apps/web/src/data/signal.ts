// Signaling override for rooms (local tests, or a squad running its own relay):
//   ?signal=ws://127.0.0.1:8787   (page URL)   or   #/r/CODE?k=KEY&signal=wss://relay.example (invite link)
// Default (no param): Trystero's public Nostr relays. Only wss://, or ws:// to this machine, is accepted.

import type { Signaling } from '@csbot/room';

export function validSignalUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  if (u.protocol === 'wss:') return u.href.replace(/\/$/, '');
  if (u.protocol === 'ws:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return u.href.replace(/\/$/, '');
  return undefined;
}

/** `signal` from an invite link's hash query (#/r/CODE?k=KEY&signal=…). */
export function signalFromLink(link: string): string | undefined {
  const hash = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link;
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return validSignalUrl(new URLSearchParams(q).get('signal'));
}

/** `signal` from the page URL (search first, then the hash query). */
export function signalFromPage(loc: Location): string | undefined {
  return validSignalUrl(new URLSearchParams(loc.search).get('signal')) ?? signalFromLink(loc.hash);
}

export const toSignaling = (url?: string): Signaling | undefined => (url ? { kind: 'ws', urls: [url] } : undefined);
