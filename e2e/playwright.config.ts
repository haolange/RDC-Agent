import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 60000,
  retries: 1,
  use: { headless: true, viewport: { width: 1400, height: 900 }, video: 'retain-on-failure' },
  webServer: {
    command: 'pnpm run dev:renderer',
    port: 5173,
    reuseExistingServer: true,
  },
});
