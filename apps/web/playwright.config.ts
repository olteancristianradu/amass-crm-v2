import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end SPA tests.
 *
 * We DON'T start a dev server automatically because these tests only make
 * sense against a live docker-compose stack — run:
 *   docker compose -f infra/docker-compose.yml up -d
 *   PLAYWRIGHT_BASE_URL=http://localhost:5173 pnpm --filter @amass/web e2e
 *
 * Or point at a deployed URL:
 *   PLAYWRIGHT_BASE_URL=https://crm.example.com pnpm --filter @amass/web e2e
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    // Ignore self-signed HTTPS warnings on local/staging deployments.
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
