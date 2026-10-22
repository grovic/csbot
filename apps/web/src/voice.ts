// Voice callouts: when the call changes (a new round or kind, or Claude's call replacing the
// engine's), read this screen's YOU line, or the headline when there's none. Per device, off by
// default, never in tournament mode. Uses the browser's speech (works offline in Electron on Windows).

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SessionView } from './data/session.ts';

const KEY = 'csbot.voice';
const subs = new Set<() => void>();
let on = (() => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } })();

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

export const voice = {
  get: () => on,
  set(v: boolean): void {
    on = v;
    try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* storage blocked: still on for this page */ }
    if (!v && voiceSupported()) { try { window.speechSynthesis.cancel(); } catch { /* nothing playing */ } }
    for (const cb of subs) cb();
  },
  subscribe(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; },
};

export function useVoiceOn(): boolean {
  return useSyncExternalStore(voice.subscribe, voice.get);
}

/** Text for speech: the UI's separators read badly aloud. */
export const speakable = (s: string) => s.replace(/\s*·\s*/g, ', ').replace(/\s*→\s*/g, ', ').replace(/–/g, ' to ');

function speak(text: string): void {
  if (!voiceSupported()) return;
  try {
    window.speechSynthesis.cancel();
    const u = new window.SpeechSynthesisUtterance(speakable(text));
    u.rate = 1.1;
    window.speechSynthesis.speak(u);
  } catch { /* no voice available */ }
}

/** Speak each new call once. Turning voice on (or opening the app) doesn't read out the current call. */
export function useVoiceCallouts(view: SessionView): void {
  const enabled = useVoiceOn();
  const call = view.screen?.live.call;
  const tournament = !!view.screen?.room?.tournament || view.screen?.coach?.status === 'tournament';
  const key = call ? `${call.round}|${call.kind}|${call.source}` : '';
  const text = call ? call.you ?? call.head : '';
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = last.current;
    last.current = key;
    if (!enabled || prev === undefined || key === prev || !key) return;
    if (tournament || !call || !['pre', 'mid', 'post'].includes(call.kind)) return;
    speak(text);
    // Only the call identity matters: a reworded YOU line (slot change) isn't a new callout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

let audio: AudioContext | undefined;
/** A short tone: up when push-to-talk starts listening, two up when it understood, down when not. */
function tone(kind: 'listening' | 'heard' | 'none' | 'error'): void {
  try {
    audio ??= new AudioContext();
    const notes = kind === 'listening' ? [880] : kind === 'heard' ? [660, 990] : [330, 247];
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain();
      const t0 = audio!.currentTime + i * 0.09;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      o.connect(g).connect(audio!.destination);
      o.start(t0);
      o.stop(t0 + 0.09);
    });
  } catch { /* no audio output */ }
}

/** Push-to-talk feedback you can hear in game: a tone per step, and the command read back when voice callouts are on. */
export function usePushToTalkCues(view: SessionView): void {
  const enabled = useVoiceOn();
  const v = view.voice;
  useEffect(() => {
    if (!v) return;
    tone(v.state);
    if (enabled && v.state === 'heard' && v.said) speak(v.said);
    // One cue per event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.at, v?.state]);
}
