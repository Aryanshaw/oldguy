import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.ts',
  timeout: 150_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    viewport: { width: 1440, height: 900 },
  },
});
