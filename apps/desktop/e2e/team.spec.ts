// The team plan end to end in the hidden desktop app: saving the playbook changes the live call right
// away (no new game update needed), it's kept on disk, and a broken playbook is refused.

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { builtinPlaybook } from '@csbot/engine';
import { FIRST_HALF, syntheticMatch } from '@csbot/gsi';
import type { LiveSnapshot, TeamPlan } from '@csbot/protocol';
import { launchApp, postGsi, screens, shot, waitFor, type LaunchedApp } from './helpers.ts';

test.describe.configure({ mode: 'serial' });
let host: LaunchedApp;

const last = (a: LaunchedApp) => a.page.evaluate(() => { const c = (window as unknown as { __snaps: LiveSnapshot[] }).__snaps; return c[c.length - 1]; });

test.beforeAll(async () => {
  host = await launchApp();
  await host.page.evaluate(() => {
    const w = window as unknown as { __snaps: LiveSnapshot[] };
    w.__snaps = [];
    window.csbot!.onSnapshot(s => { w.__snaps.push(s); if (w.__snaps.length > 30) w.__snaps.shift(); });
  });
});
test.afterAll(async () => { await host?.close(); });

test("saving the team's playbook changes the call now, and it's kept on disk", async () => {
  test.setTimeout(60_000);
  const rec = syntheticMatch({ rounds: FIRST_HALF.slice(0, 3), lean: true });
  const freeze2 = rec.findIndex(r => r.p.map?.round === 1 && r.p.round?.phase === 'freezetime');
  for (const r of rec.slice(0, freeze2 + 1)) expect((await postGsi(host.runtime, r.p)).status).toBe(200);
  const before = await waitFor(async () => { const s = await last(host); return s?.match?.round === 2 && s.match.clock.phase === 'freezetime' && s.call ? s : undefined; });
  expect(before.call!.head).not.toBe('Our team call');

  // Every CT setup says the same thing: whichever the engine picks, the call shows it.
  const pb = JSON.parse(JSON.stringify(builtinPlaybook('de_mirage')));
  for (const s of pb.setups) if (s.side === 'CT') s.calls = { default: { head: 'Our team call', sub: 'Our words', steps: [] } };
  const team: TeamPlan = { playbooks: { de_mirage: pb }, antistrats: [] };
  expect(await host.page.evaluate(t => window.csbot!.setTeam!(t), team)).toEqual({ ok: true });
  const after = await waitFor(async () => { const s = await last(host); return s?.call?.head === 'Our team call' ? s : undefined; });
  expect(after.call!.sub).toBe('Our words');
  const saved = JSON.parse(fs.readFileSync(path.join(host.dir, 'userData', 'team.json'), 'utf8')) as TeamPlan;
  expect(Object.keys(saved.playbooks)).toEqual(['de_mirage']);

  // The Playbook page shows the team's version.
  await host.page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Playbook' }).click();
  await expect(host.page.getByTestId('pb-save')).toContainText('Saved on this PC');
  await host.page.getByTestId('pb-setup').first().click();
  await expect(host.page.getByTestId('pb-call-head')).toHaveValue('Our team call');
  await shot(host, path.join(screens, 'desktop-playbook.png'));

  // A playbook without the five positions is refused; the old one stays.
  const broken = { ...pb, slots: pb.slots.slice(0, 3) };
  const r = await host.page.evaluate(t => window.csbot!.setTeam!(t), { playbooks: { de_mirage: broken }, antistrats: [] } as TeamPlan);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/five positions/);
  expect((await last(host))?.call?.head).toBe('Our team call');
});

test("the practice config goes into CS2's cfg folder (a fake install here), from the saved lineups", async () => {
  // No CS2 yet: refused.
  const none = await host.page.evaluate(() => window.csbot!.installPractice!('de_mirage'));
  expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/CS2 not found/) });
  // A fake CS2 install inside the test's own Steam folder (never the real game folder).
  const cfgDir = path.join(host.dir, 'Steam', 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg');
  fs.mkdirSync(cfgDir, { recursive: true });
  const team: TeamPlan = { playbooks: {}, antistrats: [], lineups: { de_mirage: [{ id: 'ours', name: 'Our window smoke', kind: 'smoke', side: 'T', from: [840, 270], to: [470, 410], how: 'Jumpthrow', exact: { pos: [1216.03, -211.97, -159.97], ang: [-48, -144.5] } }] } };
  expect(await host.page.evaluate(t => window.csbot!.setTeam!(t), team)).toEqual({ ok: true });
  const r = await host.page.evaluate(() => window.csbot!.installPractice!('de_mirage'));
  expect(r.ok).toBe(true);
  expect(r.path).toBe(path.join(cfgDir, 'csbot_de_mirage.cfg'));
  const cfg = fs.readFileSync(r.path!, 'utf8');
  expect(cfg).toContain('alias lineup1 "setpos 1216.03 -211.97 -159.97; setang -48 -144.5 0; give weapon_smokegrenade');
  expect(cfg.match(/^alias lineup\d+ /gm)).toHaveLength(1);
  expect(await host.page.evaluate(() => window.csbot!.installPractice!('de_nowhere'))).toEqual({ ok: false, error: 'Unknown map.' });
});
