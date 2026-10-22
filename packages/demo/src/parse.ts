// Parses a CS2 match demo (.dem) with demoparser2 (native, prebuilt, MIT): into a DemoTruth (parseDemo)
// or a 2D replay (parseReplay). Both read only the events they need plus player props at chosen ticks,
// so a full match takes about a second or less. Synchronous and CPU-bound: run it off the UI thread.

import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEvents, parseHeader, parseTicks } from '@laihoe/demoparser2';
import type { DemoReplay, DemoTruth } from '@csbot/protocol';
import {
  buildTruth, EVENT_NAMES, EVENT_OTHER_PROPS, EVENT_PLAYER_PROPS, sampleTicks, segmentRounds, TICK_PROPS,
  type RawEvent, type RawTickRow,
} from './build.ts';
import { buildReplay, REPLAY_EVENT_NAMES, REPLAY_TICK_PROPS, replayTicks } from './replay.ts';

/** The demo's map name. Throws a readable error when the file is not a CS2 demo. */
function readMap(path: string): string {
  let header: { map_name?: unknown };
  try {
    header = parseHeader(path) as { map_name?: unknown };
  } catch (err) {
    throw new Error(`Not a CS2 demo (${path}): ${err instanceof Error ? err.message : String(err)}`);
  }
  return typeof header.map_name === 'string' && header.map_name ? header.map_name : 'unknown';
}

export function parseDemo(file: string): DemoTruth {
  const path = resolve(file);
  const bytes = statSync(path).size;
  // Pass the path, not a Buffer: demoparser2 maps the file itself (faster, and half the memory).
  const map = readMap(path);
  const events = parseEvents(path, [...EVENT_NAMES], [...EVENT_PLAYER_PROPS], [...EVENT_OTHER_PROPS]) as RawEvent[];
  const rounds = segmentRounds(events);
  const ticks = sampleTicks(rounds);
  const rows = ticks.length ? (parseTicks(path, [...TICK_PROPS], ticks) as RawTickRow[]) : [];
  return buildTruth({ source: { file: path, parsedAt: Date.now(), bytes }, map, events, rows, rounds });
}

/**
 * Every real round (parseDemo's rounds) as a 2D replay: positions and hp 4 times a second, grenades,
 * kills and the plant. Only the sampled ticks are read (about a second for a 60 MB demo).
 */
export function parseReplay(file: string): DemoReplay {
  const path = resolve(file);
  const map = readMap(path);
  const events = parseEvents(path, [...REPLAY_EVENT_NAMES], [...EVENT_PLAYER_PROPS], [...EVENT_OTHER_PROPS]) as RawEvent[];
  const rounds = segmentRounds(events);
  const ticks = replayTicks(rounds);
  const rows = ticks.length ? (parseTicks(path, [...REPLAY_TICK_PROPS], ticks) as RawTickRow[]) : [];
  return buildReplay({ map, events, rows, rounds });
}
