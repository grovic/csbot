import { defineConfig } from '@playwright/test';

// Electron e2e. Windows stay hidden (CSBOT_HIDDEN=1): this PC is also the owner's gaming PC.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
});
