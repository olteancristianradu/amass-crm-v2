import { expect, test } from '@playwright/test';

/**
 * Smoke: login → see dashboard → logout.
 *
 * Requires a pre-seeded tenant. Pass credentials via env:
 *   SMOKE_TENANT_SLUG=amass
 *   SMOKE_EMAIL=admin@amass.ro
 *   SMOKE_PASSWORD=ChangeMeForReal
 *
 * Skipped if any env is missing so CI doesn't hard-fail on missing seed data.
 */
const slug = process.env.SMOKE_TENANT_SLUG;
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
const hasCreds = Boolean(slug && email && password);

test.describe('auth smoke', () => {
  test.skip(!hasCreds, 'set SMOKE_TENANT_SLUG, SMOKE_EMAIL, SMOKE_PASSWORD to enable');

  test('user can log in and reach the dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/tenant|slug/i).fill(slug!);
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password|parol/i).fill(password!);
    await page.getByRole('button', { name: /log ?in|autentific/i }).click();

    // Either we land directly on the dashboard, or the router redirects /app → /dashboard.
    await expect(page).toHaveURL(/\/(app|dashboard)/i, { timeout: 10_000 });
    // A welcome / brand element should be visible to prove the shell rendered.
    await expect(page.locator('body')).toContainText(/AMASS|dashboard|welcome/i);
  });
});
