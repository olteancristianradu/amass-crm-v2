import { expect, type APIRequestContext, type Page, test } from '@playwright/test';

const slug = process.env.SMOKE_TENANT_SLUG;
const email = process.env.SMOKE_EMAIL;
const password = process.env.SMOKE_PASSWORD;
const hasCreds = Boolean(email && password);

test.use({ trace: 'off' });

interface LoginBody {
  user: { id: string; tenantId: string; email: string };
  tokens: { accessToken: string; expiresIn: number };
}

interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

interface CompanyRow {
  id: string;
  name: string;
}

interface AttachmentRow {
  id: string;
  fileName: string;
}

test.describe('critical CRM smoke', () => {
  test.skip(!hasCreds, 'set SMOKE_EMAIL and SMOKE_PASSWORD to enable');
  test.setTimeout(90_000);

  test('creates a company, uploads/downloads an attachment, completes a task, and dismisses a reminder', async ({
    page,
    request,
  }) => {
    const loginBody = await apiLogin(request);
    const authHeaders = { Authorization: `Bearer ${loginBody.tokens.accessToken}` };
    const stamp = Date.now();
    const companyName = `Smoke Company ${stamp}`;
    const taskTitle = `Smoke task ${stamp}`;
    const reminderTitle = `Smoke reminder ${stamp}`;
    const fileName = `smoke-${stamp}.txt`;
    const fileContents = `AMASS smoke ${stamp}`;
    let companyId: string | null = null;

    try {
      await seedBrowserSession(page, loginBody);

      await page.goto('/app/companies');
      await dismissCookieBanner(page);
      await page.getByRole('button', { name: /companie nouă/i }).click();
      const companyForm = page.locator('form').filter({ has: page.getByLabel('Nume *') });
      await companyForm.getByLabel('Nume *').fill(companyName);
      await companyForm.getByLabel('CUI').fill(`RO${stamp.toString().slice(-8)}`);
      await companyForm.getByLabel('Industrie').fill('Software');
      await companyForm.getByLabel('Status relație').selectOption('PROSPECT');
      await companyForm.getByLabel('Sursă lead').selectOption('WEB');
      await companyForm.getByLabel('Email').fill(`smoke-${stamp}@example.test`);
      await companyForm.getByLabel('Telefon').fill('+40700000000');
      await companyForm.getByLabel('Oraș').fill('București');
      await companyForm.getByRole('button', { name: /^salvează$/i }).click();

      const companyLink = page.getByRole('link', { name: companyName });
      await expect(companyLink).toBeVisible({ timeout: 10_000 });
      await companyLink.click();
      await expect(page.getByRole('heading', { name: new RegExp(companyName) })).toBeVisible();
      companyId = new URL(page.url()).pathname.split('/').pop() ?? null;
      expect(companyId).toBeTruthy();

      await page.getByRole('button', { name: /fișiere/i }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(fileContents),
      });
      await expect(page.getByText(fileName)).toBeVisible({ timeout: 10_000 });

      const attachment = await waitForAttachment(request, authHeaders, companyId!, fileName);
      const downloadRes = await request.get(`/api/v1/attachments/${attachment.id}/download`, {
        headers: authHeaders,
      });
      expect(downloadRes.ok()).toBeTruthy();
      const { downloadUrl } = (await downloadRes.json()) as { downloadUrl: string };
      const fileRes = await request.get(downloadUrl);
      expect(fileRes.ok()).toBeTruthy();
      expect(await fileRes.text()).toBe(fileContents);

      await page.getByRole('button', { name: /task-uri/i }).click();
      await page.getByPlaceholder('Titlu task…').fill(taskTitle);
      await page.getByRole('button', { name: /^adaugă$/i }).click();
      const taskRow = page.locator('li').filter({ hasText: taskTitle });
      await expect(taskRow).toBeVisible({ timeout: 10_000 });
      await taskRow.getByRole('button', { name: '✓' }).click();
      await expect(taskRow.getByRole('button', { name: '✓' })).toHaveCount(0, { timeout: 10_000 });

      await page.getByRole('button', { name: /reminder-uri/i }).click();
      await page.getByLabel('Titlu *').fill(reminderTitle);
      await page.getByLabel('Note').fill('Created by Playwright smoke test');
      await page.getByRole('button', { name: /programează reminder/i }).click();
      const reminderRow = page.locator('li').filter({ hasText: reminderTitle });
      await expect(reminderRow).toContainText('PENDING', { timeout: 10_000 });
      await reminderRow.getByRole('button', { name: /închide/i }).click();
      await expect(reminderRow).toContainText('DISMISSED', { timeout: 10_000 });
    } finally {
      await cleanupCompany(request, authHeaders, companyId, companyName);
    }
  });
});

async function seedBrowserSession(page: Page, loginBody: LoginBody): Promise<void> {
  await page.addInitScript(({ user, accessToken }) => {
    localStorage.setItem(
      'amass-auth',
      JSON.stringify({
        state: { user, accessToken },
        version: 0,
      }),
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
    data: {
      tenantSlug: slug,
      email,
      password,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as LoginBody;
}

async function waitForAttachment(
  request: APIRequestContext,
  headers: Record<string, string>,
  companyId: string,
  fileName: string,
): Promise<AttachmentRow> {
  await expect
    .poll(async () => {
      const res = await request.get(`/api/v1/COMPANY/${companyId}/attachments`, { headers });
      if (!res.ok()) return null;
      const rows = (await res.json()) as AttachmentRow[];
      return rows.find((a) => a.fileName === fileName) ?? null;
    }, { timeout: 10_000 })
    .not.toBeNull();

  const res = await request.get(`/api/v1/COMPANY/${companyId}/attachments`, { headers });
  const rows = (await res.json()) as AttachmentRow[];
  return rows.find((a) => a.fileName === fileName)!;
}

async function cleanupCompany(
  request: APIRequestContext,
  headers: Record<string, string>,
  companyId: string | null,
  companyName: string,
): Promise<void> {
  const ids = new Set<string>();
  if (companyId) ids.add(companyId);

  const listRes = await request.get('/api/v1/companies', {
    headers,
    params: { q: companyName, limit: 50 },
  });
  if (listRes.ok()) {
    const page = (await listRes.json()) as CursorPage<CompanyRow>;
    for (const company of page.data) {
      if (company.name === companyName) ids.add(company.id);
    }
  }

  if (ids.size > 0) {
    await request.post('/api/v1/companies/bulk-delete', {
      headers,
      data: { ids: Array.from(ids) },
    });
  }
}
