import { describe, expect, it } from 'vitest';
import { readEnv, validSignal } from '../src/settings.ts';
import { rendererUrlFor, samePage } from '../src/urls.ts';

const FILE = 'file:///C:/GitHub/grovic/csbot/apps/web/dist/index.html';

describe('renderer URL', () => {
  it('passes a signaling override as ?signal=', () => {
    expect(rendererUrlFor(FILE)).toBe(FILE);
    const u = new URL(rendererUrlFor(FILE, 'ws://127.0.0.1:5000/'));
    expect(u.searchParams.get('signal')).toBe('ws://127.0.0.1:5000/');
    expect(u.pathname).toBe('/C:/GitHub/grovic/csbot/apps/web/dist/index.html');
  });

  it('treats the same file with any query or hash as our page, nothing else', () => {
    const r = rendererUrlFor(FILE, 'ws://127.0.0.1:5000/');
    expect(samePage(`${FILE}#/room`, r)).toBe(true);
    expect(samePage(`${FILE}?signal=x#/r/K7P2QX?k=abc`, r)).toBe(true);
    expect(samePage('file:///C:/Windows/System32/drivers/etc/hosts', r)).toBe(false);
    expect(samePage('https://evil.example/index.html', r)).toBe(false);
    expect(samePage('http://localhost:5173/#/live', 'http://localhost:5173/')).toBe(true);
    expect(samePage('http://localhost:5174/', 'http://localhost:5173/')).toBe(false);
    expect(samePage('not a url', r)).toBe(false);
  });
});

describe('CSBOT_SIGNAL', () => {
  it('accepts wss anywhere and ws only on this machine', () => {
    expect(validSignal('wss://relay.example.org')).toBe('wss://relay.example.org/');
    expect(validSignal('ws://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/');
    expect(validSignal('ws://localhost:8787')).toBe('ws://localhost:8787/');
    expect(validSignal('ws://192.168.1.20:8787')).toBeUndefined();
    expect(validSignal('http://127.0.0.1:8787')).toBeUndefined();
    expect(validSignal('nonsense')).toBeUndefined();
    expect(readEnv({ CSBOT_SIGNAL: 'ws://127.0.0.1:1' }).signal).toBe('ws://127.0.0.1:1/');
  });
});
