import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || path.join(tmpdir(), 'marching-band-playwright-results'),
  fullyParallel: false,
  use: { baseURL: process.env.E2E_URL || 'http://127.0.0.1:5173', channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: process.env.E2E_URL ? undefined : {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI,
  },
});
