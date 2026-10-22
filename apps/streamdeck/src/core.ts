// The plugin's logic, without the Stream Deck connection or the network (tests drive it directly).
//
// Keys:
//   Intel      enemies seen in one of the map's three lanes (A side, mid, B side), or the lane clear
//   Check-in   on my spot, or rotating to A or B (squad markers in a room)
//   Talk       csbot's push-to-talk (when it's on in csbot)
//   Call       shows the team call and the enemy buy read; pressing it refreshes
//
// Fair play: the keys talk to csbot only. Nothing here touches the game.

export const ACTIONS = {
  intel: 'com.grovic.csbot.intel',
  checkin: 'com.grovic.csbot.checkin',
  talk: 'com.grovic.csbot.talk',
  call: 'com.grovic.csbot.call',
} as const;

export type Lane = 'a' | 'mid' | 'b';
export interface KeySettings { lane?: Lane; count?: number; checkin?: 'spot' | 'A' | 'B' }

/** What csbot's control API tells the plugin (apps/desktop/src/control.ts). */
export interface ControlState {
  map?: string;
  mapName?: string;
  phase?: string;
  call?: { head: string; you?: string };
  enemy?: { read: string };
  /** The map's three lanes and their zone names. */
  lanes?: Partial<Record<Lane, string>>;
}

export type Command =
  | { kind: 'intel'; lane: Lane; count: number }
  | { kind: 'checkin'; state: 'spot' | 'rotate'; site?: 'A' | 'B' }
  | { kind: 'talk' };

export interface Csbot {
  state(): Promise<ControlState | undefined>;
  command(c: Command): Promise<{ ok: boolean; error?: string }>;
}

/** Messages from the Stream Deck app (the parts the plugin uses). */
export interface SdEvent {
  event: string;
  action?: string;
  context?: string;
  payload?: { settings?: KeySettings };
}

const LANE_NAME: Record<Lane, string> = { a: 'A side', mid: 'Mid', b: 'B side' };
const COUNT_WORD = ['CLEAR', '1', '2', '3', '4', '5'];

/** Key titles are about 3 lines of 8-9 characters: wrap words, cut what doesn't fit. */
export function wrap(text: string, width = 9, lines = 3): string {
  const out: string[] = [];
  let cur = '';
  for (const w of text.replace(/[·→]/g, ' ').split(/\s+/).filter(Boolean)) {
    const word = w.length > width ? w.slice(0, width) : w;
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= width) cur += ' ' + word;
    else { out.push(cur); cur = word; }
    if (out.length === lines) break;
  }
  if (cur && out.length < lines) out.push(cur);
  return out.slice(0, lines).join('\n');
}

export function titleFor(action: string, s: KeySettings, state: ControlState | undefined): string {
  switch (action) {
    case ACTIONS.intel: {
      const lane = s.lane ?? 'a', count = Math.max(0, Math.min(5, s.count ?? 1));
      return `${COUNT_WORD[count]}\n${wrap(state?.lanes?.[lane] ?? LANE_NAME[lane], 9, 2)}`;
    }
    case ACTIONS.checkin:
      return s.checkin === 'A' || s.checkin === 'B' ? `Rotate\n${s.checkin}` : 'On my\nspot';
    case ACTIONS.talk:
      return 'Talk';
    case ACTIONS.call:
      if (!state) return 'csbot\noff';
      if (!state.call) return wrap(state.mapName ?? 'No call', 9, 3);
      return `${(state.enemy?.read ?? '').toUpperCase().slice(0, 9)}\n${wrap(state.call.head, 9, 2)}`;
    default:
      return '';
  }
}

export function commandFor(action: string, s: KeySettings): Command | undefined {
  switch (action) {
    case ACTIONS.intel: return { kind: 'intel', lane: s.lane ?? 'a', count: Math.max(0, Math.min(5, s.count ?? 1)) };
    case ACTIONS.checkin: return s.checkin === 'A' || s.checkin === 'B' ? { kind: 'checkin', state: 'rotate', site: s.checkin } : { kind: 'checkin', state: 'spot' };
    case ACTIONS.talk: return { kind: 'talk' };
    default: return undefined;
  }
}

export class CsbotPlugin {
  private readonly keys = new Map<string, { action: string; settings: KeySettings }>();
  private readonly titles = new Map<string, string>();
  private last?: ControlState;
  private readonly send: (m: object) => void;
  private readonly csbot: Csbot;

  constructor(send: (m: object) => void, csbot: Csbot) { this.send = send; this.csbot = csbot; }

  async handle(e: SdEvent): Promise<void> {
    const ctx = e.context;
    switch (e.event) {
      case 'willAppear':
      case 'didReceiveSettings':
        if (ctx && e.action) { this.keys.set(ctx, { action: e.action, settings: e.payload?.settings ?? {} }); this.title(ctx); }
        break;
      case 'willDisappear':
        if (ctx) { this.keys.delete(ctx); this.titles.delete(ctx); }
        break;
      case 'keyDown': {
        const k = ctx ? this.keys.get(ctx) : undefined;
        if (!ctx || !k) break;
        if (k.action === ACTIONS.call) { await this.poll(); break; }
        const cmd = commandFor(k.action, k.settings);
        if (!cmd) break;
        const r = await this.csbot.command(cmd).catch(() => ({ ok: false }));
        this.send({ event: r.ok ? 'showOk' : 'showAlert', context: ctx });
        break;
      }
    }
  }

  /** Read csbot's state and refresh every key's title (only titles that changed are sent). */
  async poll(): Promise<void> {
    this.last = await this.csbot.state().catch(() => undefined);
    for (const ctx of this.keys.keys()) this.title(ctx);
  }

  private title(ctx: string): void {
    const k = this.keys.get(ctx);
    if (!k) return;
    const t = titleFor(k.action, k.settings, this.last);
    if (this.titles.get(ctx) === t) return;
    this.titles.set(ctx, t);
    this.send({ event: 'setTitle', context: ctx, payload: { title: t, target: 0 } });
  }
}
