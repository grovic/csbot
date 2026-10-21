// Scouting on the host: holds the current ScoutView, fetches FACEIT/Steam data with the keys stored
// on this PC (or the fictional sample), and runs the AI report on the user's own Claude Code.
// Pure Node (no Electron import): unit-tested with sample clients and a fake analyst.

import {
  ApiError, faceitClient, parseFaceitMatch, recentFromHistory, SAMPLE_MATCH_ID, sampleFaceit, sampleSteam, sampleSteamId, scoutFaceitMatch, steamClient, withReport,
  type CacheStore, type FaceitApi, type SteamApi,
} from '@csbot/scout';
import { EMPTY_SCOUT, type DataSourceState, type RecentMatch, type ScoutReport, type ScoutView } from '@csbot/protocol';
import type { AnalystResult } from './claude.ts';
import type { KeyService } from './secrets.ts';

export interface KeyStore { get(service: KeyService): string | undefined }

export interface AnalystRunner {
  detect(): Promise<boolean>;
  run(view: ScoutView): Promise<AnalystResult>;
}

export interface ScoutServiceOptions {
  keys: KeyStore;
  cache?: CacheStore;
  analyst?: AnalystRunner;
  /** Our own Steam ID, from this PC's GSI. */
  ourSteamId?: () => string | undefined;
  /** Room members by Steam ID or nickname (case-insensitive) → their room role (others on our side are randoms). */
  roomSteamIds?: () => Record<string, 'admin' | 'member'> | undefined;
  makeFaceit?: (key: string) => FaceitApi;
  makeSteam?: (key: string) => SteamApi;
  now?: () => number;
  /** Run the report automatically after a scout (default true). */
  autoReport?: boolean;
  /** Manual re-runs per match on top of the automatic one (default 2). */
  manualRuns?: number;
}

export const ERRORS = {
  badLink: "That doesn't look like a FACEIT match link. Open your match room on faceit.com and copy its address.",
  noKey: 'Add your FACEIT API key in Settings, or try the sample match.',
  noKeyAccount: 'Add your FACEIT API key first: csbot looks your account up with it.',
  auth: 'FACEIT refused your API key. Check it in Settings.',
  notFound: 'FACEIT has no match with that link. Copy the link from your match room.',
  rateLimit: 'FACEIT is limiting requests right now. Try again in a minute.',
  network: "Can't reach FACEIT. Check your internet connection.",
  server: 'FACEIT had a problem answering. Try again in a moment.',
  noClaude: "Claude Code isn't installed on this PC, so there's no AI report. Every number above still comes from the data.",
  budget: 'The AI report has already run 3 times for this match.',
} as const;

type Listener = (v: ScoutView) => void;

export class ScoutService {
  private readonly o: ScoutServiceOptions & { now: () => number; autoReport: boolean; manualRuns: number };
  private view: ScoutView = structuredClone(EMPTY_SCOUT);
  private listeners = new Set<Listener>();
  private claude: DataSourceState = 'off';
  private authFailed: Partial<Record<KeyService, string>> = {};
  /** Bumped by every new scout; results from an older one are dropped. */
  private gen = 0;
  private runs = new Map<string, { auto: number; manual: number }>();
  /** Last good report per match: re-scouting (fresh data) keeps it instead of spending another call. */
  private reports = new Map<string, ScoutReport>();
  private reportBusy = false;
  /** The host's FACEIT account and recent matches: kept across scouts (merged into every view). */
  private account?: NonNullable<ScoutView['account']> & { playerId?: string };
  private recent?: RecentMatch[];
  /** Live matches already scouted automatically (never twice). */
  private autoScouted = new Set<string>();

  constructor(o: ScoutServiceOptions) {
    this.o = { now: Date.now, autoReport: true, manualRuns: 2, ...o };
    this.view.sources = this.sources();
  }

  /** Ask once whether Claude Code is installed. */
  async init(): Promise<void> {
    this.claude = (await this.o.analyst?.detect().catch(() => false)) ? 'live' : 'off';
    this.refreshSources();
  }

  /**
   * Check the saved keys once (at startup): a key that was revoked, or saved by a build that didn't
   * check keys, shows as refused in Settings before the first scout instead of during it.
   */
  async verifyKeys(): Promise<{ faceit?: boolean; steam?: boolean }> {
    const out: { faceit?: boolean; steam?: boolean } = {};
    const fk = this.o.keys.get('faceit'), sk = this.o.keys.get('steam');
    const check = async (service: KeyService, ping: (() => Promise<void>) | undefined) => {
      if (!ping) return;
      try { await ping(); out[service] = true; } catch (e) {
        if (e instanceof ApiError && e.kind === 'auth') { out[service] = false; this.markAuthError(service); }
      }
    };
    await Promise.all([
      fk ? check('faceit', this.faceit()?.ping) : undefined,
      sk ? check('steam', (this.o.makeSteam ?? (k => steamClient({ apiKey: k })))(sk).ping) : undefined,
    ]);
    return out;
  }

  get current(): ScoutView { return this.view; }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** After a key is saved or cleared. */
  refreshSources(): void {
    for (const s of ['faceit', 'steam'] as const) if (this.authFailed[s] !== undefined && this.authFailed[s] !== this.o.keys.get(s)) delete this.authFailed[s];
    this.set({ ...this.view, sources: this.sources() });
  }

  async scoutMatch(linkOrId: string): Promise<{ ok: boolean; error?: string }> {
    const id = parseFaceitMatch(linkOrId ?? '');
    if (!id) return { ok: false, error: ERRORS.badLink };
    const key = this.o.keys.get('faceit');
    if (!key) return { ok: false, error: ERRORS.noKey };
    const steamKey = this.o.keys.get('steam');
    const faceit = (this.o.makeFaceit ?? (k => faceitClient({ apiKey: k, ...(this.o.cache ? { cache: this.o.cache } : {}) })))(key);
    const steam = steamKey ? (this.o.makeSteam ?? (k => steamClient({ apiKey: k, ...(this.o.cache ? { cache: this.o.cache } : {}) })))(steamKey) : undefined;
    return this.scout(id, 'faceit', faceit, steam, this.o.ourSteamId?.(), this.o.roomSteamIds?.());
  }

  async scoutSample(): Promise<void> {
    const room: Record<string, 'admin' | 'member'> = {};
    for (const [nick, role] of [['rdx', 'admin'], ['kairo', 'member'], ['nyx', 'member'], ['mbt', 'member']] as const) room[sampleSteamId(nick)!] = role;
    await this.scout(SAMPLE_MATCH_ID, 'sample', sampleFaceit(), sampleSteam(), sampleSteamId('rdx'), room);
  }

  /** The room changed: relabel our side (admin / member / random) without refetching anything. */
  relabelRoom(): void {
    if (this.view.status !== 'ready' || this.view.platform === 'sample') return;
    const room = new Map(Object.entries(this.o.roomSteamIds?.() ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const players = this.view.us.players.map(p => ({ ...p, room: (p.steamid ? room.get(p.steamid) : undefined) ?? room.get(p.nickname.toLowerCase()) ?? 'random' as const }));
    this.set({ ...this.view, us: { ...this.view.us, players } });
  }

  /**
   * The host's FACEIT nickname (null clears it). Looks the account up, then lists recent matches.
   * Needs a FACEIT key; the nickname itself is public and stored in plain settings.
   */
  async setNickname(nickname: string | null): Promise<{ ok: boolean; error?: string }> {
    const nick = nickname?.trim();
    if (!nick) { this.account = undefined; this.recent = undefined; this.set({ ...this.view }); return { ok: true }; }
    const faceit = this.faceit();
    if (!faceit?.playerByNickname) {
      this.account = { nickname: nick, status: 'error', error: ERRORS.noKeyAccount };
      this.set({ ...this.view });
      return { ok: false, error: ERRORS.noKeyAccount };
    }
    try {
      const p = await faceit.playerByNickname(nick);
      const g = p.games?.cs2;
      this.account = { nickname: p.nickname, status: 'ok', playerId: p.player_id, ...(g?.skill_level ? { level: g.skill_level } : {}), ...(g?.faceit_elo ? { elo: g.faceit_elo } : {}) };
      this.set({ ...this.view });
      await this.refreshRecent();
      return { ok: true };
    } catch (e) {
      const notFound = e instanceof ApiError && e.kind === 'not-found';
      if (e instanceof ApiError && e.kind === 'auth') this.markAuthError('faceit');
      this.account = { nickname: nick, status: notFound ? 'not-found' : 'error', ...(notFound ? {} : { error: this.explain(e) }) };
      this.recent = undefined;
      this.set({ ...this.view });
      return { ok: false, error: notFound ? `FACEIT has no player called "${nick}".` : this.explain(e) };
    }
  }

  /**
   * Refresh the recent list (the host calls this every minute). A match that shows up live and
   * wasn't scouted yet gets scouted automatically, once.
   */
  async refreshRecent(): Promise<void> {
    const faceit = this.faceit();
    const id = this.account?.playerId;
    if (!faceit || !id) return;
    try {
      this.recent = recentFromHistory(id, await faceit.history(id, 6));
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'auth') this.markAuthError('faceit');
      return;
    }
    this.set({ ...this.view });
    const live = this.recent.find(m => m.live);
    if (live && !this.autoScouted.has(live.id) && this.view.matchId !== live.id && this.view.status !== 'loading') {
      this.autoScouted.add(live.id);
      await this.scoutMatch(live.id);
    }
  }

  private faceit(): FaceitApi | undefined {
    const key = this.o.keys.get('faceit');
    if (!key) return undefined;
    return (this.o.makeFaceit ?? (k => faceitClient({ apiKey: k, ...(this.o.cache ? { cache: this.o.cache } : {}) })))(key);
  }

  /** Manual (re-)run from the Scout page. */
  async runReport(): Promise<{ ok: boolean; error?: string }> {
    return this.report(this.gen, false);
  }

  /** Record a refused key (also used when a background refresh hits 401). */
  markAuthError(service: KeyService): void {
    const key = this.o.keys.get(service);
    if (key) this.authFailed[service] = key;
    this.refreshSources();
  }

  // ---------------------------------------------------------------- internals

  private async scout(matchId: string, platform: 'faceit' | 'sample', faceit: FaceitApi, steam: SteamApi | undefined, ourSteamId?: string, room?: Record<string, 'admin' | 'member'>): Promise<{ ok: boolean; error?: string }> {
    const gen = ++this.gen;
    this.set({ ...structuredClone(EMPTY_SCOUT), status: 'loading', platform, matchId, sources: this.sources(platform) });
    try {
      const v = await scoutFaceitMatch(
        { faceit, ...(steam ? { steam } : {}), sources: this.sources(platform), now: this.o.now },
        { matchId, platform, ...(ourSteamId ? { ourSteamId } : {}), ...(room ? { room } : {}) },
      );
      if (gen !== this.gen) return { ok: true };
      const fresh: ScoutView = { ...v, sources: { ...this.sources(platform), steam: v.sources.steam === 'error' ? 'error' : this.sources(platform).steam } };
      const kept = this.reports.get(matchId);
      if (kept) this.set(withReport(fresh, kept));
      else {
        this.set(fresh);
        if (this.o.autoReport) void this.report(gen, true);
      }
      return { ok: true };
    } catch (e) {
      if (gen !== this.gen) return { ok: false };
      const error = this.explain(e);
      if (e instanceof ApiError && e.kind === 'auth' && e.service === 'FACEIT') this.markAuthError('faceit');
      this.set({ ...structuredClone(EMPTY_SCOUT), status: 'error', error, platform, matchId, sources: this.sources(platform) });
      return { ok: false, error };
    }
  }

  private async report(gen: number, auto: boolean): Promise<{ ok: boolean; error?: string }> {
    const v = this.view;
    if (v.status !== 'ready' || !v.matchId) return { ok: false, error: 'Scout a match first.' };
    if (this.claude !== 'live' || !this.o.analyst) {
      this.set({ ...v, report: { status: 'off', error: ERRORS.noClaude } });
      return { ok: false, error: ERRORS.noClaude };
    }
    if (this.reportBusy) return { ok: false, error: 'The report is already running.' };
    const used = this.runs.get(v.matchId) ?? { auto: 0, manual: 0 };
    if (auto ? used.auto >= 1 : used.manual >= this.o.manualRuns) {
      if (!auto) this.set({ ...v, report: { ...v.report, error: ERRORS.budget } });
      return { ok: false, error: ERRORS.budget };
    }
    this.runs.set(v.matchId, auto ? { ...used, auto: used.auto + 1 } : { ...used, manual: used.manual + 1 });
    this.reportBusy = true;
    const previous = v.report;
    this.set({ ...v, report: { status: 'running', ...(previous.status === 'ready' ? keepText(previous) : {}) } });
    try {
      const r = await this.o.analyst.run(v);
      if (gen !== this.gen) return { ok: true };
      const { model, ms, ...text } = r;
      const report: ScoutReport = { status: 'ready', model, ms, at: this.o.now(), ...text };
      this.reports.set(v.matchId, report);
      this.set(withReport(this.view, report));
      return { ok: true };
    } catch (e) {
      if (gen !== this.gen) return { ok: false };
      const error = (e as Error).message || 'The AI report failed.';
      this.set({ ...this.view, report: previous.status === 'ready' ? { ...previous, error } : { status: 'error', error } });
      return { ok: false, error };
    } finally {
      this.reportBusy = false;
    }
  }

  private sources(platform?: ScoutView['platform']): ScoutView['sources'] {
    const sample = (platform ?? this.view.platform) === 'sample';
    const state = (s: KeyService): DataSourceState => {
      const key = this.o.keys.get(s);
      if (!key) return sample ? 'sample' : 'missing-key';
      return this.authFailed[s] === key ? 'error' : 'live';
    };
    return { faceit: state('faceit'), steam: state('steam'), claude: this.claude };
  }

  private explain(e: unknown): string {
    if (e instanceof ApiError) {
      switch (e.kind) {
        case 'auth': return ERRORS.auth;
        case 'not-found': return ERRORS.notFound;
        case 'rate-limit': return ERRORS.rateLimit;
        case 'network': return ERRORS.network;
        default: return ERRORS.server;
      }
    }
    return `Scouting failed: ${(e as Error).message ?? 'unknown error'}`;
  }

  private set(v: ScoutView): void {
    const { playerId: _id, ...account } = this.account ?? ({} as NonNullable<ScoutService['account']>);
    v = { ...v, ...(this.account ? { account } : {}), ...(this.recent ? { recent: this.recent } : {}) };
    if (!this.account) delete v.account;
    if (!this.recent) delete v.recent;
    this.view = v;
    for (const cb of this.listeners) { try { cb(v); } catch { /* a bad listener must not break scouting */ } }
  }
}

const keepText = (r: ScoutReport): Partial<ScoutReport> => {
  const { status: _s, error: _e, ...rest } = r;
  return rest;
};
