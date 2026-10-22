// Push-to-talk phrases (M7). The recognizer only listens for this list, plus "coach …" followed by free
// speech, so a match is exact: "three B apps", "B apps three", "B apps clear", "on my spot",
// "rotating A", "coach should we save". Pure: the speech helper gets the texts, and what it hears is
// looked up here.

import { GEOS } from '@csbot/engine';
import type { VoiceCommand } from '@csbot/protocol';

export interface VoicePhrase { text: string; cmd: VoiceCommand }

const COUNTS = ['one', 'two', 'three', 'four', 'five'] as const;

/** Extra spoken names, by zone name (any map). The zone's own name is always one. */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  'A Site': ['A'],
  'B Site': ['B'],
  Mid: ['middle'],
  'B Apps': ['B apartments'],
  Apartments: ['apps'],
  Connector: ['con'],
  'Snipers Nest': ['nest'],
  'Ladder Room': ['ladder'],
  'Long A': ['long'],
  'A Long': ['long A', 'long'],
  Underpass: ['under'],
  'Palace Alley': ['palace alley'],
  CT: ['CT lane'],
  'Short': ['short A'],
  'Upper Tunnel': ['upper', 'tunnels'],
  'Lower Tunnel': ['lower'],
};

/** Words for the recognizer: lower case except site letters and side names (said as letters). */
function spoken(name: string): string {
  return name.split(/\s+/).map(w => (/^(A|B|CT|T)$/.test(w) ? w : w.toLowerCase())).join(' ');
}

export const CHECKIN_PHRASES: readonly VoicePhrase[] = [
  ...['on my spot', 'on spot', 'in position'].map(text => ({ text, cmd: { kind: 'checkin', state: 'spot' } as const })),
  ...(['A', 'B'] as const).flatMap(site => [`rotating ${site}`, `rotating to ${site}`, `rotate ${site}`].map(text => ({ text, cmd: { kind: 'checkin', state: 'rotate', site } as const }))),
];

/** Everything that can be said on this map (intel needs a map; check-ins always work). */
export function voicePhrases(map: string | undefined): VoicePhrase[] {
  const geo = map ? GEOS[map] : undefined;
  const out = new Map<string, VoicePhrase>();
  const add = (text: string, cmd: VoiceCommand) => { if (!out.has(text.toLowerCase())) out.set(text.toLowerCase(), { text, cmd }); };
  for (const p of CHECKIN_PHRASES) add(p.text, p.cmd);
  if (geo) {
    // A name two zones could mean is dropped (except a zone's own name, which wins).
    const own = new Set(geo.zones.map(z => spoken(z.name).toLowerCase()));
    const names = new Map<string, string>();
    for (const z of geo.zones) {
      for (const n of [spoken(z.name), ...(ALIASES[z.name] ?? [])]) {
        const k = n.toLowerCase();
        if (names.has(k) || (n !== spoken(z.name) && own.has(k))) continue;
        names.set(k, z.id);
        const zone = z.id;
        COUNTS.forEach((c, i) => {
          add(`${c} ${n}`, { kind: 'intel', zone, count: i + 1 });
          add(`${n} ${c}`, { kind: 'intel', zone, count: i + 1 });
        });
        add(`${n} clear`, { kind: 'intel', zone, count: 0 });
        add(`clear ${n}`, { kind: 'intel', zone, count: 0 });
      }
    }
  }
  return [...out.values()];
}

/** The wake word for a question to the coach; what follows is free speech. */
export const QUESTION_WORD = 'coach';

/** What a recognized text means, or nothing (said something else). */
export function commandFor(text: string, phrases: readonly VoicePhrase[]): VoiceCommand | undefined {
  const t = text.trim().replace(/\s+/g, ' ');
  const q = new RegExp(`^${QUESTION_WORD}\\b[,.]?\\s*(.+)$`, 'i').exec(t);
  if (q) {
    const question = q[1]!.trim();
    return question.length >= 3 ? { kind: 'question', text: question.charAt(0).toUpperCase() + question.slice(1) + (/[?.!]$/.test(question) ? '' : '?') } : undefined;
  }
  const k = t.toLowerCase();
  return phrases.find(p => p.text.toLowerCase() === k)?.cmd;
}

/** A short read-back of a command ("3 seen B Apps"), for the toast and the voice confirmation. */
export function describeCommand(cmd: VoiceCommand, map: string | undefined): string {
  if (cmd.kind === 'question') return `Asked: ${cmd.text}`;
  if (cmd.kind === 'checkin') return cmd.state === 'spot' ? 'On my spot' : `Rotating → ${cmd.site}`;
  const name = (map ? GEOS[map]?.zones.find(z => z.id === cmd.zone)?.name : undefined) ?? cmd.zone;
  return cmd.count === 0 ? `${name} clear` : `${cmd.count} ${name}`;
}
