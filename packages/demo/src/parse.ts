// Parses a CS2 match demo (.dem) into a DemoTruth with demoparser2 (native, prebuilt, MIT).
// Reads only the events it needs plus the player props at one short tick window per round, so a full
// match takes well under a second. Synchronous and CPU-bound: run it off the UI thread.

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEvents, parseHeader, parseTicks } from '@laihoe/demoparser2';
import type { DemoTruth } from '@csbot/protocol';
import {
  buildTruth, EVENT_NAMES, EVENT_OTHER_PROPS, EVENT_PLAYER_PROPS, sampleTicks, segmentRounds, TICK_PROPS,
  type RawEvent, type RawTickRow,
} from './build.ts';

export function parseDemo(file: string): DemoTruth {
  const path = resolve(file);
  const bytes = statSync(path).size;
  // Pass the path, not a Buffer: demoparser2 maps the file itself (faster, and half the memory).
  let header: { map_name?: unknown };
  try {
    header = parseHeader(path) as { map_name?: unknown };
  } catch (err) {
    throw new Error(`Not a CS2 demo (${path}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const events = parseEvents(path, [...EVENT_NAMES], [...EVENT_PLAYER_PROPS], [...EVENT_OTHER_PROPS]) as RawEvent[];
  const rounds = segmentRounds(events);
  const ticks = sampleTicks(rounds);
  const rows = ticks.length ? (parseTicks(path, [...TICK_PROPS], ticks) as RawTickRow[]) : [];
  return buildTruth({
    source: { file: path, parsedAt: Date.now(), bytes },
    map: typeof header.map_name === 'string' && header.map_name ? header.map_name : 'unknown',
    events,
    rows,
    rounds,
  });
}
