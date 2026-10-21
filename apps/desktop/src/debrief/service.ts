// The host's debrief: records every match from its own snapshots, keeps them in userData/matches,
// attaches a demo's truth to its match, and asks the user's Claude Code for "work on next".

import fs from 'node:fs';
import path from 'node:path';
import { debriefStats, MatchRecorder, parseWorkOn, recordFromTruth, WORKON_SCHEMA, WORKON_SYSTEM, workOnInput } from '@csbot/debrief';
import type { DebriefView, DemoTruth, LiveSnapshot, MatchRecord, MatchSummary } from '@csbot/protocol';

export interface ClaudeJson { (o: { system: string; schema: object; input: string }): Promise<{ output: unknown; model: string }> }

export interface DebriefServiceOptions {
  /** Where records live (one JSON file per match). */
  dir: string;
  onChange: (v: DebriefView) => void;
  runClaude?: ClaudeJson;
  parseDemo?: (file: string) => Promise<DemoTruth>;
  /** CS2's replays folder, where downloaded match demos land. */
  replaysDir?: string;
  /** This PC's player (Steam ID), so a demo of a match csbot wasn't open for still has an "us". */
  ourSteamId?: () => string | undefined;
  /** Keep at most this many matches (oldest go first). */
  keep?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

const SAFE_ID = /^[0-9]+-[a-z0-9_]+$/;

export class DebriefService {
  private readonly o: DebriefServiceOptions;
  private readonly recorder: MatchRecorder;
  private readonly records = new Map<string, MatchRecord>();
  private selected?: string;
  private demo: NonNullable<DebriefView['demo']> = { status: 'none' };
  private savedRounds = -1;
  private busy = false;

  constructor(o: DebriefServiceOptions) {
    this.o = o;
    this.recorder = new MatchRecorder({ onFinish: r => { this.store(r); this.selected = r.id; } });
    fs.mkdirSync(o.dir, { recursive: true });
    for (const f of fs.readdirSync(o.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(o.dir, f), 'utf8')) as MatchRecord;
        if (r?.id && SAFE_ID.test(r.id) && Array.isArray(r.rounds)) this.records.set(r.id, r);
      } catch { /* a damaged file: skip it */ }
    }
    if (o.replaysDir) this.demo.replaysDir = o.replaysDir;
  }

  /** Every live snapshot of the host: saved after each round and at the end of the match. */
  observe(s: LiveSnapshot): void {
    const r = this.recorder.observe(s);
    if (!r) return;
    const done = r.rounds.filter(x => x.winner).length;
    if (done !== this.savedRounds && done > 0) { this.savedRounds = done; this.store(r); }
  }

  view(): DebriefView {
    const list = [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt);
    const record = (this.selected && this.records.get(this.selected)) || list[0];
    const matches: MatchSummary[] = list.map(r => {
      const rating = debriefStats(r).rating;
      return { id: r.id, map: r.map, startedAt: r.startedAt, finished: r.finished, score: { ...r.score }, ...(rating !== undefined ? { rating } : {}), hasDemo: !!r.truth };
    });
    return { ...(record ? { record } : {}), matches, demo: { ...this.demo } };
  }

  select(id: string): void {
    if (!this.records.has(id)) return;
    this.selected = id;
    this.emit();
  }

  /** Attach a demo's truth to the match it belongs to (same map, our player in it, about the same rounds). */
  async ingest(file: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.o.parseDemo) return { ok: false, error: "This build can't read demos." };
    if (this.busy) return { ok: false, error: 'Already reading a demo.' };
    if (!fs.existsSync(file)) return { ok: false, error: 'That file is gone.' };
    this.busy = true;
    this.demo = { ...this.demo, status: 'parsing', detail: path.basename(file) };
    this.emit();
    try {
      const truth = await this.o.parseDemo(file);
      let rec = this.matchFor(truth);
      if (rec) rec.truth = truth;
      else {
        // A match csbot wasn't open for: rebuild it from the demo, from this PC's player's side.
        const me = this.o.ourSteamId?.();
        const mtime = fs.statSync(file).mtimeMs;
        rec = me ? recordFromTruth(truth, me, mtime) : undefined;
        if (!rec) {
          this.demo = { ...this.demo, status: 'error', detail: `No ${truth.map.replace(/^de_/, '')} match in csbot's records fits this demo, and ${me ? "you're not in it" : "csbot doesn't know your Steam ID yet (it learns it from CS2)"}.` };
          return { ok: false, error: this.demo.detail! };
        }
      }
      this.store(rec);
      this.selected = rec.id;
      this.demo = { ...this.demo, status: 'ready', detail: path.basename(file) };
      return { ok: true };
    } catch (e) {
      this.demo = { ...this.demo, status: 'error', detail: `Couldn't read the demo: ${(e as Error).message}` };
      return { ok: false, error: this.demo.detail! };
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  async writeWorkOn(id: string): Promise<{ ok: boolean; error?: string }> {
    const rec = this.records.get(id);
    if (!rec) return { ok: false, error: 'No such match.' };
    if (!this.o.runClaude) return { ok: false, error: "Claude Code isn't available on this PC." };
    if (rec.rounds.filter(r => r.winner).length < 3) return { ok: false, error: 'Play a few more rounds first.' };
    try {
      const r = await this.o.runClaude({ system: WORKON_SYSTEM, schema: WORKON_SCHEMA, input: 'One match csbot recorded:\n' + workOnInput(rec) });
      rec.workOn = parseWorkOn(r.output, r.model, this.now());
      this.store(rec);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private matchFor(truth: DemoTruth): MatchRecord | undefined {
    const candidates = [...this.records.values()]
      .filter(r => r.map === truth.map && r.rounds.length > 0)
      .filter(r => !r.me || truth.players.length === 0 || truth.players.some(p => p.steamid === r.me!.steamid))
      .filter(r => Math.abs(r.rounds.length - truth.rounds.length) <= 2)
      .sort((a, b) => b.startedAt - a.startedAt);
    return candidates.find(r => !r.truth) ?? candidates[0];
  }

  private store(r: MatchRecord): void {
    const copy = structuredClone(r);
    this.records.set(copy.id, copy);
    // Keep the newest records only.
    const keep = this.o.keep ?? 300;
    const all = [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt);
    for (const old of all.slice(keep)) { this.records.delete(old.id); fs.rmSync(path.join(this.o.dir, old.id + '.json'), { force: true }); }
    if (!SAFE_ID.test(copy.id)) return;
    const file = path.join(this.o.dir, copy.id + '.json');
    try {
      fs.writeFileSync(file + '.tmp', JSON.stringify(copy));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { this.o.log?.(`debrief: couldn't save ${copy.id}: ${(e as Error).message}`); }
    this.emit();
  }

  private emit(): void { this.o.onChange(this.view()); }
  private now(): number { return (this.o.now ?? Date.now)(); }
}
