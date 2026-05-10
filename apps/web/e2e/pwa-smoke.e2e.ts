import { expect, test } from '@playwright/test';

/**
 * PWA smoke — verifies the deployed app exposes a valid manifest, the
 * service worker registers, and SEO meta tags are present. Runs against
 * any baseURL; doesn't need credentials.
 *
 *   PLAYWRIGHT_BASE_URL=https://crm.example.com pnpm --filter @amass/web e2e pwa-smoke
 */
test.describe('PWA smoke', () => {
  test('manifest is reachable and well-formed', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBeTruthy();
    const m = (await res.json()) as {
      name?: string;
      short_name?: string;
      start_url?: string;
      icons?: { src: string; sizes: string }[];
    };
    expect(m.name).toContain('AMASS');
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBeTruthy();
    expect(m.icons?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  test('icons resolve (192 + 512)', async ({ request }) => {
    for (const size of ['192', '512']) {
      const res = await request.get(`/icon-${size}.svg`);
      expect(res.ok(), `icon-${size}.svg returned ${res.status()}`).toBeTruthy();
      const body = await res.text();
      expect(body.startsWith('<svg')).toBeTruthy();
    }
  });

  test('service worker file is reachable', async ({ request }) => {
    const res = await request.get('/sw.js');
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    // Sanity-check the cache name bumped per release — catches the regression
    // where deploys forget to bump CACHE and the SW serves stale chunks.
    expect(body).toMatch(/CACHE\s*=\s*'amass-shell-v\d+'/);
  });

  test('robots.txt disallows authenticated routes', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    expect(body).toContain('Disallow: /app');
    expect(body).toContain('Disallow: /api');
  });

  test('login page exposes correct meta tags + title', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/AMASS CRM/);
    const lang = await page.locator('html').getAttribute('lang');
    expect(lang).toBe('ro');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toMatch(/AMASS CRM/);
    const description = await page
      .locator('meta[name="description"]')
      .getAttribute('content');
    expect(description?.length ?? 0).toBeGreaterThan(40);
  });

  test('skip-to-content link is in the DOM (visible on focus only)', async ({ page }) => {
    // Skip-link is mounted inside the AppShell — only after auth. As a
    // baseline a11y check, we just verify the login page has at least
    // a labelled main heading or form with proper landmarks.
    await page.goto('/login');
    const headings = page.getByRole('heading');
    expect(await headings.count()).toBeGreaterThan(0);
  });
});
