// Players in the match from CS2's console `status` output, pasted by the user (spike 3). csbot never
// reads the console itself. Steam IDs come in three forms depending on the build: [U:1:n], STEAM_x:y:z
// and the 64-bit form; names are the quoted text on the same line. Bots and lines without an ID are skipped.

export interface StatusPlayer { steamid: string; name?: string }
export interface StatusRoster { players: StatusPlayer[]; map?: string; lines: number }

const BASE = 76561197960265728n;
const ID3 = /\[U:1:(\d{1,10})\]/;
const ID2 = /STEAM_[0-5]:([01]):(\d{1,10})/;
const ID64 = /\b(7656119\d{10})\b/;
const QUOTED = /(['"])(.{1,64}?)\1/g;
const MAP = /^\s*map\s*:\s*([a-z0-9_]+)/im;

export function steamIdOf(line: string): string | undefined {
  const a = ID3.exec(line);
  if (a) return String(BASE + BigInt(a[1]!));
  const b = ID2.exec(line);
  if (b) return String(BASE + BigInt(b[2]!) * 2n + BigInt(b[1]!));
  return ID64.exec(line)?.[1];
}

export function parseStatus(text: string): StatusRoster {
  const lines = text.slice(0, 20_000).split(/\r?\n/);
  const seen = new Map<string, StatusPlayer>();
  for (const line of lines) {
    if (/\bBOT\b/.test(line)) continue;
    const steamid = steamIdOf(line);
    if (!steamid || seen.has(steamid)) continue;
    const quoted = [...line.matchAll(QUOTED)].map(m => m[2]!.trim()).filter(Boolean);
    const name = quoted[quoted.length - 1];
    seen.set(steamid, { steamid, ...(name ? { name } : {}) });
  }
  const map = MAP.exec(text)?.[1];
  return { players: [...seen.values()].slice(0, 12), ...(map ? { map } : {}), lines: lines.length };
}
