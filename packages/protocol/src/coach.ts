// The live coach (M5): the host's own Claude Code, one warm session per match, writing the team call
// at freeze time and after a plant, and answering questions from the room. The engine's call shows
// instantly; Claude's replaces it when it lands. Budgets keep plan usage predictable.

export type CoachModel = 'sonnet' | 'haiku' | 'opus';

export interface CoachConfig {
  /** Admin switch. Off = engine calls only. */
  enabled: boolean;
  model: CoachModel;
  effort: 'low' | 'medium' | 'high';
  /** Claude calls per match (calls + answers to the admin), then engine calls only. */
  callBudget: number;
  /** Questions each member may ask per match. */
  memberQuota: number;
  /** Ask Claude for a post-plant call too (costs one more call per planted round). */
  postPlant: boolean;
}

export const DEFAULT_COACH_CONFIG: CoachConfig = {
  enabled: true, model: 'sonnet', effort: 'low', callBudget: 40, memberQuota: 5, postPlant: true,
};

export type CoachStatus =
  /** Claude Code isn't installed, or the admin turned the coach off. */
  | 'off'
  /** Room-wide tournament mode: no live coaching. */
  | 'tournament'
  /** No match yet. */
  | 'idle'
  | 'starting'
  | 'ready'
  /** A call or an answer is being written. */
  | 'busy'
  /** The per-match budget is used up: engine calls only. */
  | 'budget'
  | 'error';

export interface CoachMessage {
  id: string;
  at: number;
  kind: 'question' | 'answer' | 'call' | 'system';
  /** Who asked (questions) — a member name, or the host. */
  author?: string;
  authorId?: string;
  text: string;
  round?: number;
  /** Answers: the question they answer. */
  replyTo?: string;
  ms?: number;
}

export interface CallLogEntry {
  id: string;
  at: number;
  round: number;
  trigger: 'freeze' | 'intel' | 'plant' | 'question' | 'warmup';
  status: 'ok' | 'late' | 'timeout' | 'error' | 'skipped';
  model?: string;
  ms?: number;
  head?: string;
  error?: string;
  /** Plan usage at API-equivalent prices, as reported by Claude Code (cumulative per session). */
  costUsd?: number;
}

export interface CoachView {
  status: CoachStatus;
  /** Why the coach is off or erroring, in plain words. */
  detail?: string;
  config: CoachConfig;
  budget: { used: number; max: number };
  /** Questions asked per member id this match. */
  quota: { perMember: number; used: Record<string, number> };
  /** Chat, oldest first (capped). */
  messages: CoachMessage[];
  /** Every Claude request this match, newest first (capped). */
  calls: CallLogEntry[];
}

export const EMPTY_COACH: CoachView = {
  status: 'idle', config: DEFAULT_COACH_CONFIG, budget: { used: 0, max: DEFAULT_COACH_CONFIG.callBudget },
  quota: { perMember: DEFAULT_COACH_CONFIG.memberQuota, used: {} }, messages: [], calls: [],
};

/** Who asks: the host itself, or a room member (the host checks permissions and quota). */
export interface CoachAsker { id: string; name: string; role: 'admin' | 'member' }
