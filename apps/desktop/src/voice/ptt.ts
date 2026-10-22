// Push-to-talk (M7): press the key, say one thing, csbot acts on it. "three B apps" logs intel, "A
// clear" logs the zone clear, "on my spot" / "rotating B" checks in, "coach should we save" asks the
// coach. Off by default. Nothing is heard until the key is pressed, and then only one utterance,
// recognized offline by Windows. Fair play: csbot only listens for the key; it never sends input to
// the game.

import type { HostInfo, VoiceEvent } from '@csbot/protocol';
import type { ShortcutApi } from '../hotkeys.ts';
import { commandFor, describeCommand, QUESTION_WORD, voicePhrases, type VoicePhrase } from './grammar.ts';
import type { Recognizer } from './recognizer.ts';

/** Keys push-to-talk can use (Electron accelerator → label). None of them is an intel hotkey. */
export const VOICE_KEYS: readonly { accelerator: string; key: string }[] = [
  { accelerator: 'num0', key: 'Num0' },
  { accelerator: 'numadd', key: 'Num+' },
  { accelerator: 'numsub', key: 'Num-' },
  { accelerator: 'nummult', key: 'Num*' },
  { accelerator: 'F9', key: 'F9' },
  { accelerator: 'F10', key: 'F10' },
];
export const DEFAULT_VOICE_KEY = 'Num0';

/** Below this the recognizer was guessing: say "didn't catch that" instead of acting. */
const MIN_CONFIDENCE = 0.55;
/** Free speech scores lower than a fixed phrase; the text is shown, so a wrong word is visible. */
const MIN_QUESTION_CONFIDENCE = 0.3;

export interface PushToTalkOptions {
  shortcuts: ShortcutApi;
  recognizer: () => Recognizer;
  onEvent: (e: VoiceEvent) => void;
  log?: (m: string) => void;
}

export class PushToTalk {
  private enabled = false;
  private key = DEFAULT_VOICE_KEY;
  private map?: string;
  private registered?: string;
  private error?: string;
  private busy = false;
  private phrases: VoicePhrase[] = [];
  private rec?: Recognizer;
  private readonly o: PushToTalkOptions;

  constructor(o: PushToTalkOptions) { this.o = o; }

  /** Turn it on (starts the speech helper, registers the key) or off. */
  async setEnabled(on: boolean, key?: string): Promise<{ ok: boolean; error?: string }> {
    if (key !== undefined && !VOICE_KEYS.some(k => k.key === key)) return { ok: false, error: 'Unknown key.' };
    this.unregister();
    this.enabled = on;
    if (key) this.key = key;
    this.error = undefined;
    if (!on) { this.rec?.dispose(); this.rec = undefined; return { ok: true }; }
    try {
      this.rec ??= this.o.recognizer();
      await this.rec.start();
      await this.loadGrammar();
    } catch (e) {
      this.rec?.dispose();
      this.rec = undefined;
      this.error = (e as Error).message;
      return { ok: false, error: this.error };
    }
    if (!this.enabled) return { ok: true }; // switched off while starting
    const acc = VOICE_KEYS.find(k => k.key === this.key)!.accelerator;
    let ok = false;
    try { ok = this.o.shortcuts.register(acc, () => { void this.press(); }); } catch { ok = false; }
    if (ok) this.registered = acc;
    else this.error = `${this.key} is taken by another app.`;
    return this.error ? { ok: false, error: this.error } : { ok: true };
  }

  /** The current map (from the host's snapshots): its zone names become the phrases. */
  setMap(map: string | undefined): void {
    if (map === this.map) return;
    this.map = map;
    if (this.enabled && this.rec) this.loadGrammar().catch(e => this.o.log?.(`voice: grammar not loaded: ${(e as Error).message}`));
  }

  /** The key was pressed: listen for one utterance (a WAV file in tests) and say what it meant. */
  async press(file?: string): Promise<VoiceEvent | undefined> {
    if (!this.enabled || !this.rec || this.busy) return undefined; // a second press while listening does nothing
    this.busy = true;
    this.o.onEvent({ state: 'listening' });
    let ev: VoiceEvent;
    try {
      const h = await this.rec.listen(file);
      const cmd = h ? commandFor(h.text, this.phrases) : undefined;
      const min = cmd?.kind === 'question' ? MIN_QUESTION_CONFIDENCE : MIN_CONFIDENCE;
      ev = !h ? { state: 'none' }
        : !cmd || h.confidence < min ? { state: 'none', text: h.text }
        : { state: 'heard', text: h.text, command: cmd, said: describeCommand(cmd, this.map) };
    } catch (e) {
      ev = { state: 'error', error: (e as Error).message };
    } finally {
      this.busy = false;
    }
    this.o.onEvent(ev);
    return ev;
  }

  status(): NonNullable<HostInfo['voice']> {
    const zone = this.phrases.find(p => p.cmd.kind === 'intel' && p.cmd.count === 3)?.text;
    return {
      enabled: this.enabled,
      key: this.key,
      keys: VOICE_KEYS.map(k => k.key),
      examples: [zone ?? 'three B', zone ? zone.replace(/^three /, '') + ' clear' : 'B clear', 'on my spot', 'rotating A', `${QUESTION_WORD} should we save this round`],
      ...(this.error ? { error: this.error } : {}),
    };
  }

  dispose(): void {
    this.enabled = false;
    this.unregister();
    this.rec?.dispose();
    this.rec = undefined;
  }

  private async loadGrammar(): Promise<void> {
    const phrases = voicePhrases(this.map);
    this.phrases = phrases;
    await this.rec!.setPhrases(phrases.map(p => p.text), QUESTION_WORD);
  }

  private unregister(): void {
    if (!this.registered) return;
    try { this.o.shortcuts.unregister(this.registered); } catch { /* already gone */ }
    this.registered = undefined;
  }
}
