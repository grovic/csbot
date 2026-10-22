import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Session, SessionView } from './data/session.ts';

export function useSession(session: Session): SessionView {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** 'join' is an invite link (#/r/CODE?k=KEY). */
export type Route = 'live' | 'scout' | 'playbook' | 'debrief' | 'coach' | 'settings' | 'room' | 'join';
const ROUTES: readonly Route[] = ['live', 'scout', 'playbook', 'debrief', 'coach', 'settings', 'room'];

function parse(hash: string): Route {
  const r = hash.replace(/^#\/?/, '').split(/[/?]/)[0] as Route | 'r';
  if (r === 'r') return 'join';
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
