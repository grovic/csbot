// Low-memory mode (M8): on by default (csbot draws without the graphics card); turning it off asks for
// a restart, and a csbot started with it off draws with the graphics card.

import { expect, test, type Page } from '@playwright/test';
import type { HostInfo } from '@csbot/protocol';
import { launchApp } from './helpers.ts';

const info = (p: Page) => p.evaluate(() => window.csbot!.getInfo()) as Promise<HostInfo>;

test('on by default; turning it off waits for a restart', async () => {
  const app = await launchApp();
  try {
    expect((await info(app.page)).lowMemory).toEqual({ enabled: true, active: true });
    expect(await app.app.evaluate(({ app: a }) => a.isHardwareAccelerationEnabled())).toBe(false);
    await app.page.getByRole('link', { name: 'Settings', exact: true }).click();
    await app.page.getByTestId('mem-toggle').uncheck();
    await expect(app.page.getByTestId('mem-restart')).toBeVisible();
    expect((await info(app.page)).lowMemory).toEqual({ enabled: false, active: true });
  } finally { await app.close(); }
});

test('started with it off: drawn with the graphics card', async () => {
  const app = await launchApp({}, { settings: { lowMemory: false } });
  try {
    expect((await info(app.page)).lowMemory).toEqual({ enabled: false, active: false });
    expect(await app.app.evaluate(({ app: a }) => a.isHardwareAccelerationEnabled())).toBe(true);
  } finally { await app.close(); }
});
