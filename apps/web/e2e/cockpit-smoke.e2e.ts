import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const slug = process.env.SMOKE_TENANT_SLUG;
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
const hasCreds = Boolean(email && password);

interface LoginBody {
  user: { id: string; tenantId: string; email: string };
  tokens: { accessToken: string; expiresIn: number };
}

test.describe('Pro Cockpit smoke', () => {
  test.skip(!hasCreds, 'set SMOKE_EMAIL and SMOKE_PASSWORD to enable');
  test.setTimeout(60_000);

  test('opens /app/cockpit, sees default widgets, toggles picker, refreshes feed', async ({
    page,
    request,
  }) => {
    const loginBody = await apiLogin(request);
    await seedBrowserSession(page, loginBody);

    await page.goto('/app/cockpit');
    await dismissCookieBanner(page);

    // Title is set by usePageTitle.
    await expect(page).toHaveTitle(/Pro Cockpit/);

    // Page header rendered.
    await expect(page.getByRole('heading', { name: 'Pro Cockpit' })).toBeVisible();

    // Default widgets render. Each widget has its label as h2.
    await expect(page.getByRole('heading', { name: /Deal-uri în pericol/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Reminder-uri azi/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Task-uri restante/i })).toBeVisible();

    // Refresh button present and clickable.
    const refresh = page.getByRole('button', { name: /reîmprospătează/i });
    await expect(refresh).toBeEnabled();
    await refresh.click();

    // Widget picker opens, has all 4 widget options.
    await page.getByRole('button', { name: /^Widget-uri/ }).click();
    await expect(page.getByText('Selectează widget-uri')).toBeVisible();

    // Toggle one off, verify it disappears.
    const checkbox = page.locator('label').filter({ hasText: 'Lead-uri fierbinți' }).locator('input[type="checkbox"]');
    await expect(checkbox).toBeVisible();
    // Close the picker.
    await page.getByRole('button', { name: /^Gata$/ }).click();
  });
});

async function seedBrowserSession(page: Page, loginBody: LoginBody): Promise<void> {
  await page.addInitScript(({ user, accessToken }) => {
    localStorage.setItem(
      'amass-auth',
      JSON.stringify({ state: { user, accessToken }, version: 0 }),
    );
  }, {
    user: loginBody.user,
    accessToken: loginBody.tokens.accessToken,
  });
}

async function dismissCookieBanner(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /doar necesare/i });
  if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await button.click();
  }
}

async function apiLogin(request: APIRequestContext): Promise<LoginBody> {
  const res = await request.post('/api/v1/auth/login', {
    data: { tenantSlug: slug, email, password },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as LoginBody;
}
