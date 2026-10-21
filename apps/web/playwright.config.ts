import { defineConfig } from '@playwright/test';

const PORT = 4317;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
  },
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
