// The V1 numbers from one measurement run (csbot started with --metrics): memory and CPU while a
// match is on, how fast each round's call reaches every screen, the coach's own time, room reconnects.
// Pure: the CLI (report.ts) reads the files.

export interface Proc { pid: number; type: string; cpuTotal?: number; ws: number; priv?: number }
export interface Sample { t: number; procs: Proc[] }
export interface Event { t: number; ev: string; [k: string]: unknown }

export interface Stat { n: number; p50?: number; p95?: number; max?: number }

export interface ScreenTiming {
  id: string;
  name: string;
  device: string;
  /** Seconds from round end until this screen showed the next round's call (whoever wrote it). */
  firstCall: Stat;
  /** Seconds from round end until this screen showed Claude's call for the next round. */
  claudeCall: Stat;
}

export interface MatchReport {
  map: string;
  mode?: string;
  from: number;
  to: number;
  minutes: number;
  rounds: number;
  finished: boolean;
  footprint?: {
    samples: number;
    privAvgMB: number;
    privPeakMB: number;
    wsPeakMB: number;
    cpuMachinePct: number;
    cpuPeakMachinePct: number;
    byType: Record<string, { privAvgMB: number; cpuSec: number }>;
    /** Share of the match the window was on screen (not hidden or minimized), when known. */
    windowVisible?: number;
    pass: { memory: boolean; cpu: boolean };
  };
  calls: {
    /** Round ends measured (the next round wasn't a half start and the match went on). */
    roundEnds: number;
    screens: ScreenTiming[];
    firstCallP95?: number;
    claudeCallP95?: number;
    /** The V1 check: Claude's call when the coach wrote calls, else the engine's, p95 ≤ 8 s. */
    pass?: boolean;
  };
  coach: { requests: number; byStatus: Record<string, number>; ms: Stat; costUsd?: number; model?: string };
  room: { members: string[]; reconnects: { name: string; seconds: number }[]; reconnectP95?: number };
  faceit: { seen: boolean; liveStatuses: string[] };
}

const MATCH_PHASES = new Set(['freezetime', 'live', 'bomb', 'over', 'halftime', 'paused']);
const DONE = new Set(['FINISHED', 'CANCELLED', 'ABORTED']);
const MB = 1024; // metrics are in KB

export function stat(xs: number[]): Stat {
  if (!xs.length) return { n: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const rank = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { n: s.length, p50: r(rank(0.5)), p95: r(rank(0.95)), max: r(s[s.length - 1]!) };
}

const halfLength = (mode?: string) => (mode === 'scrimcomp2v2' ? 8 : 12);
function isHalfStart(round: number, half: number): boolean {
  if (round === 1 || round === half + 1) return true;
  return round > 2 * half && (round - 2 * half - 1) % 3 === 0;
}

/** Matches in the run: from the first in-match phase to game over (or the last event), split on a new map or round 1. */
export function matchesIn(events: Event[]): { map: string; mode?: string; from: number; to: number; finished: boolean; events: Event[] }[] {
  const out: { map: string; mode?: string; from: number; to: number; finished: boolean; events: Event[] }[] = [];
  let cur: (typeof out)[number] | undefined;
  let lastRound = 0;
  for (const e of events) {
    if (e.ev === 'phase') {
      const phase = String(e.phase), map = String(e.map), round = Number(e.round);
      const fresh = !cur || cur.finished || cur.map !== map || (round < lastRound && round <= 1);
      if (MATCH_PHASES.has(phase) && fresh) {
        cur = { map, ...(typeof e.mode === 'string' ? { mode: e.mode } : {}), from: e.t, to: e.t, finished: false, events: [] };
        out.push(cur);
      }
      if (cur && !cur.finished && phase === 'gameover') { cur.finished = true; cur.to = e.t; cur.events.push(e); }
      lastRound = round;
    }
    if (cur && !cur.finished) { cur.to = e.t; cur.events.push(e); }
  }
  return out;
}

function footprint(samples: Sample[], from: number, to: number, cores: number, windowVisible?: number): MatchReport['footprint'] {
  const win = samples.filter(s => s.t >= from && s.t <= to);
  if (win.length < 2) return undefined;
  const priv = win.map(s => s.procs.reduce((m, p) => m + (p.priv ?? 0), 0) / MB);
  const ws = win.map(s => s.procs.reduce((m, p) => m + p.ws, 0) / MB);
  const cpuBetween = (a: Sample, b: Sample) => {
    let sec = 0;
    for (const p of b.procs) {
      const q = a.procs.find(x => x.pid === p.pid);
      if (q && p.cpuTotal !== undefined && q.cpuTotal !== undefined) sec += Math.max(0, p.cpuTotal - q.cpuTotal);
    }
    return { sec, wall: (b.t - a.t) / 1000 };
  };
  let cpuSec = 0, peak = 0;
  for (let i = 1; i < win.length; i++) {
    const c = cpuBetween(win[i - 1]!, win[i]!);
    cpuSec += c.sec;
    if (c.wall > 0) peak = Math.max(peak, (c.sec / c.wall) * 100);
  }
  const wall = (win[win.length - 1]!.t - win[0]!.t) / 1000;
  const byType: Record<string, { priv: number[]; cpuSec: number }> = {};
  for (const s of win) {
    const sum: Record<string, number> = {};
    for (const p of s.procs) sum[p.type] = (sum[p.type] ?? 0) + (p.priv ?? 0) / MB;
    for (const [k, v] of Object.entries(sum)) (byType[k] ??= { priv: [], cpuSec: 0 }).priv.push(v);
  }
  const first = win[0]!, last = win[win.length - 1]!;
  for (const p of last.procs) {
    const q = first.procs.find(x => x.pid === p.pid);
    if (q && p.cpuTotal !== undefined && q.cpuTotal !== undefined && byType[p.type]) byType[p.type]!.cpuSec += p.cpuTotal - q.cpuTotal;
  }
  const avg = (x: number[]) => x.reduce((m, v) => m + v, 0) / Math.max(1, x.length);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const privPeak = Math.max(...priv);
  const cpuMachine = wall ? (cpuSec / wall) * 100 / cores : 0;
  return {
    samples: win.length, privAvgMB: r1(avg(priv)), privPeakMB: r1(privPeak), wsPeakMB: r1(Math.max(...ws)),
    cpuMachinePct: Math.round(cpuMachine * 100) / 100, cpuPeakMachinePct: Math.round((peak / cores) * 100) / 100,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { privAvgMB: r1(avg(v.priv)), cpuSec: Math.round(v.cpuSec * 10) / 10 }])),
    ...(windowVisible !== undefined ? { windowVisible: Math.round(windowVisible * 100) / 100 } : {}),
    pass: { memory: privPeak < 400, cpu: cpuMachine < 3 },
  };
}

/** Share of [from, to] the window was visible and not minimized, from 'window' events (undefined: never reported). */
function visibleShare(events: Event[], from: number, to: number): number | undefined {
  const w = events.filter(e => e.ev === 'window');
  if (!w.length) return undefined;
  let on = false, at = from, total = 0;
  for (const e of w) {
    const now = e.visible === true && e.minimized !== true;
    if (e.t <= from) { on = now; continue; }
    if (e.t >= to) break;
    if (on) total += e.t - at;
    on = now; at = e.t;
  }
  if (on) total += to - at;
  return to > from ? total / (to - from) : undefined;
}

function callTimings(m: { mode?: string; events: Event[] }, end: number): MatchReport['calls'] {
  const half = halfLength(m.mode);
  const overAt = new Map<number, number>();
  for (const e of m.events) if (e.ev === 'phase' && e.phase === 'over' && !overAt.has(Number(e.round))) overAt.set(Number(e.round), e.t);
  const freezeRounds = new Set(m.events.filter(e => e.ev === 'phase' && e.phase === 'freezetime').map(e => Number(e.round)));
  const ends = [...overAt].filter(([r]) => !isHalfStart(r + 1, half) && freezeRounds.has(r + 1));
  const shown = m.events.filter(e => e.ev === 'shown');
  const screens = new Map<string, { id: string; name: string; device: string }>();
  for (const e of shown) screens.set(`${e.id}|${e.device}`, { id: String(e.id), name: String(e.name), device: String(e.device) });
  const out: ScreenTiming[] = [];
  const all = { first: [] as number[], claude: [] as number[] };
  for (const [k, sc] of screens) {
    const mine = shown.filter(e => `${e.id}|${e.device}` === k);
    const first: number[] = [], claude: number[] = [];
    for (const [r, t] of ends) {
      const next = (re: RegExp) => mine.find(e => e.t >= t - 50 && e.t <= end && re.test(String(e.key)));
      const f = next(new RegExp(`^${r + 1}:pre:`));
      const c = next(new RegExp(`^${r + 1}:pre:claude$`));
      if (f) first.push((f.t - t) / 1000);
      if (c) claude.push((c.t - t) / 1000);
    }
    all.first.push(...first);
    all.claude.push(...claude);
    out.push({ ...sc, firstCall: stat(first), claudeCall: stat(claude) });
  }
  const fp = stat(all.first).p95, cp = stat(all.claude).p95;
  const judged = all.claude.length ? cp : fp;
  return {
    roundEnds: ends.length, screens: out,
    ...(fp !== undefined ? { firstCallP95: fp } : {}), ...(cp !== undefined ? { claudeCallP95: cp } : {}),
    ...(judged !== undefined ? { pass: judged <= 8 } : {}),
  };
}

function coachStats(events: Event[]): MatchReport['coach'] {
  const c = events.filter(e => e.ev === 'coach' && e.trigger !== 'warmup' && e.trigger !== 'question');
  const byStatus: Record<string, number> = {};
  for (const e of c) byStatus[String(e.status)] = (byStatus[String(e.status)] ?? 0) + 1;
  const costs = events.filter(e => e.ev === 'coach' && typeof e.costUsd === 'number').map(e => e.costUsd as number);
  const model = [...events].reverse().find(e => e.ev === 'coach' && typeof e.model === 'string')?.model as string | undefined;
  return {
    requests: c.length, byStatus,
    ms: stat(c.filter(e => typeof e.ms === 'number' && (e.status === 'ok' || e.status === 'late')).map(e => (e.ms as number) / 1000)),
    ...(costs.length ? { costUsd: Math.max(...costs) } : {}), ...(model ? { model } : {}),
  };
}

function roomStats(events: Event[]): MatchReport['room'] {
  const members = new Set<string>();
  const offAt = new Map<string, number>();
  const reconnects: { name: string; seconds: number }[] = [];
  for (const e of events) {
    if (e.ev !== 'online' && e.ev !== 'offline') continue;
    const id = String(e.id);
    members.add(String(e.name));
    if (e.ev === 'offline') offAt.set(id, e.t);
    else if (offAt.has(id)) { reconnects.push({ name: String(e.name), seconds: Math.round((e.t - offAt.get(id)!) / 100) / 10 }); offAt.delete(id); }
  }
  const p95 = stat(reconnects.map(r => r.seconds)).p95;
  return { members: [...members], reconnects, ...(p95 !== undefined ? { reconnectP95: p95 } : {}) };
}

function faceitStats(events: Event[]): MatchReport['faceit'] {
  const lists = events.filter(e => e.ev === 'faceitRecent');
  const live = new Set<string>();
  for (const e of lists) for (const m of (e.matches as { status?: string }[] | undefined) ?? []) if (m.status && !DONE.has(m.status.toUpperCase())) live.add(m.status);
  return { seen: lists.length > 0, liveStatuses: [...live] };
}

export function analyze(samples: Sample[], events: Event[], o: { cores: number }): MatchReport[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  return matchesIn(sorted).map(m => {
    const inMatch = sorted.filter(e => e.t >= m.from && e.t <= m.to);
    const rounds = Math.max(0, ...m.events.filter(e => e.ev === 'phase').map(e => Number(e.round) || 0));
    const fp = footprint(samples, m.from, m.to, o.cores, visibleShare(sorted, m.from, m.to));
    return {
      map: m.map, ...(m.mode ? { mode: m.mode } : {}), from: m.from, to: m.to, minutes: Math.round((m.to - m.from) / 6000) / 10,
      rounds, finished: m.finished, ...(fp ? { footprint: fp } : {}),
      calls: callTimings({ ...(m.mode ? { mode: m.mode } : {}), events: inMatch }, m.to),
      coach: coachStats(inMatch), room: roomStats(inMatch), faceit: faceitStats(sorted),
    };
  });
}
