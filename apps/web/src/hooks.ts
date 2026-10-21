import type { LiveSnapshot } from '@csbot/protocol';
import { useEffect, useState } from 'react';
import type { SnapshotSource } from './data/index.ts';

export interface Received { snap: LiveSnapshot; receivedAt: number }

export function useSnapshot(source: SnapshotSource): Received | undefined {
  const [state, set] = useState<Received>();
  useEffect(() => source.subscribe(snap => set({ snap, receivedAt: Date.now() })), [source]);
  return state;
}

export type Route = 'live' | 'scout' | 'debrief' | 'coach' | 'settings';
const ROUTES: readonly Route[] = ['live', 'scout', 'debrief', 'coach', 'settings'];

function parse(hash: string): Route {
  const r = hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route;
  return ROUTES.includes(r) ? r : 'live';
}

export function useHashRoute(): Route {
  const [route, set] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const on = () => set(parse(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Re-render every `ms` while `active`. */
export function useTicker(ms: number, active = true): number {
  const [now, set] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => set(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms, active]);
  return now;
}
