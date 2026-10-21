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
