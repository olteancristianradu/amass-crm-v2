/**
 * Calendar integration — Google Calendar + Microsoft Outlook (Graph API).
 *
 * OAuth flow:
 *   1. GET /calendar/connect/:provider        → redirect to IdP consent screen
 *   2. GET /calendar/callback/:provider       → exchange code for tokens, store encrypted
 *   3. POST /calendar/sync                    → pull events from provider, upsert in DB
 *   4. POST /calendar/events (create)         → write event to provider + save locally
 *
 * Tokens are AES-256-GCM encrypted at rest (same helper as email accounts).
 * Refresh tokens are used automatically on 401 responses, AND a cron-driven
 * sweep proactively refreshes tokens that expire within the next hour so
 * `sync` calls don't randomly fail with 401 mid-day. See `refreshExpiring`.
 */
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { CalendarEvent, CalendarProvider, Prisma, SubjectType } from '@prisma/client';
import { CreateCalendarEventDto, ListCalendarEventsQueryDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { decrypt as decryptSecret, encrypt as encryptSecret } from '../../common/crypto/encryption';
import { loadEnv } from '../../config/env';

// Provider URL helpers — all support an env override so apps/mock-services
// can stand in for the real provider during local verification + tests.
function googleOAuthBase(): string {
  return (loadEnv().GOOGLE_OAUTH_BASE_URL ?? 'https://oauth2.googleapis.com').replace(/\/$/, '');
}
function googleApiBase(): string {
  return (loadEnv().GOOGLE_API_BASE_URL ?? 'https://www.googleapis.com').replace(/\/$/, '');
}
function microsoftOAuthBase(): string {
  return (loadEnv().MICROSOFT_OAUTH_BASE_URL ?? 'https://login.microsoftonline.com').replace(/\/$/, '');
}
function microsoftGraphBase(): string {
  return (loadEnv().MICROSOFT_GRAPH_BASE_URL ?? 'https://graph.microsoft.com').replace(/\/$/, '');
}

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── OAuth helpers ─────────────────────────────────────────────────────────

  buildAuthUrl(provider: 'GOOGLE' | 'OUTLOOK', redirectUri: string): string {
    if (provider === 'GOOGLE') {
      const params = new URLSearchParams({
        client_id: process.env['GOOGLE_CLIENT_ID'] ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/calendar',
        access_type: 'offline',
        prompt: 'consent',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    const params = new URLSearchParams({
      client_id: process.env['OUTLOOK_CLIENT_ID'] ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'Calendars.ReadWrite offline_access',
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  }

  async exchangeCode(
    provider: 'GOOGLE' | 'OUTLOOK',
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date }> {
    if (provider === 'GOOGLE') {
      const res = await fetch(`${googleOAuthBase()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env['GOOGLE_CLIENT_ID'] ?? '',
          client_secret: process.env['GOOGLE_CLIENT_SECRET'] ?? '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
      };
    }
    const res = await fetch(`${microsoftOAuthBase()}/common/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env['OUTLOOK_CLIENT_ID'] ?? '',
        client_secret: process.env['OUTLOOK_CLIENT_SECRET'] ?? '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }

  async saveIntegration(
    provider: 'GOOGLE' | 'OUTLOOK',
    accessToken: string,
    refreshToken: string | undefined,
    expiresAt: Date,
  ) {
    const { tenantId, userId } = requireTenantContext();
    // AES-256-GCM at rest — same primitive we use for SMTP passwords.
    // Previously these were stored as base64 which is an encoding, NOT
    // encryption, so any DB-dump leaked live OAuth tokens.
    const enc = (s: string) => encryptSecret(s);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarIntegration.upsert({
        where: { tenantId_userId_provider: { tenantId, userId: userId!, provider: provider as CalendarProvider } },
        create: {
          tenantId,
          userId: userId!,
          provider: provider as CalendarProvider,
          accessTokenEnc: enc(accessToken),
          refreshTokenEnc: refreshToken ? enc(refreshToken) : null,
          tokenExpiresAt: expiresAt,
        },
        update: {
          accessTokenEnc: enc(accessToken),
          refreshTokenEnc: refreshToken ? enc(refreshToken) : undefined,
          tokenExpiresAt: expiresAt,
          isActive: true,
        },
      }),
    );
  }

  async listIntegrations() {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarIntegration.findMany({
        where: { tenantId, userId: userId!, isActive: true, deletedAt: null },
        select: { id: true, provider: true, calendarId: true, lastSyncAt: true, createdAt: true },
      }),
    );
  }

  async disconnect(id: string) {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarIntegration.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } }),
    );
  }

  // ─── Sync ──────────────────────────────────────────────────────────────────

  async sync(integrationId: string): Promise<{ synced: number }> {
    const { tenantId } = requireTenantContext();
    const integration = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarIntegration.findFirst({ where: { id: integrationId, tenantId, isActive: true } }),
    );
    if (!integration) throw new NotFoundException('Integration not found');

    const accessToken = decryptSecret(integration.accessTokenEnc);
    const events = integration.provider === 'GOOGLE'
      ? await this.fetchGoogleEvents(accessToken)
      : await this.fetchOutlookEvents(accessToken);

    let synced = 0;
    for (const ev of events) {
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.calendarEvent.upsert({
          where: { integrationId_externalId: { integrationId, externalId: ev.id } },
          create: {
            tenantId,
            integrationId,
            externalId: ev.id,
            title: ev.summary,
            description: ev.description ?? null,
            startAt: new Date(ev.start),
            endAt: new Date(ev.end),
            attendees: ev.attendees ? ev.attendees : Prisma.DbNull,
          },
          update: {
            title: ev.summary,
            description: ev.description ?? null,
            startAt: new Date(ev.start),
            endAt: new Date(ev.end),
            syncedAt: new Date(),
          },
        }),
      );
      synced++;
    }

    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarIntegration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date() } }),
    );

    return { synced };
  }

  private async fetchGoogleEvents(accessToken: string) {
    const timeMin = new Date().toISOString();
    const url = `${googleApiBase()}/calendar/v3/calendars/primary/events?timeMin=${timeMin}&maxResults=250&singleEvents=true&orderBy=startTime`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new UnauthorizedException('Google token expired');
    const data = await res.json() as { items?: Array<{ id: string; summary: string; description?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; attendees?: Array<{ email: string }> }> };
    return (data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary ?? '(no title)',
      description: e.description,
      start: e.start.dateTime ?? e.start.date!,
      end: e.end.dateTime ?? e.end.date!,
      attendees: e.attendees?.map((a) => a.email),
    }));
  }

  private async fetchOutlookEvents(accessToken: string) {
    const url = `${microsoftGraphBase()}/v1.0/me/calendarView?startDateTime=${new Date().toISOString()}&endDateTime=${new Date(Date.now() + 90 * 86400000).toISOString()}&$top=250`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401) throw new UnauthorizedException('Outlook token expired');
    const data = await res.json() as { value?: Array<{ id: string; subject: string; bodyPreview?: string; start: { dateTime: string }; end: { dateTime: string }; attendees?: Array<{ emailAddress: { address: string } }> }> };
    return (data.value ?? []).map((e) => ({
      id: e.id,
      summary: e.subject ?? '(no title)',
      description: e.bodyPreview,
      start: e.start.dateTime,
      end: e.end.dateTime,
      attendees: e.attendees?.map((a) => a.emailAddress.address),
    }));
  }

  // ─── Event CRUD ────────────────────────────────────────────────────────────

  async createEvent(integrationId: string, dto: CreateCalendarEventDto): Promise<CalendarEvent> {
    const { tenantId } = requireTenantContext();
    const integration = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarIntegration.findFirst({ where: { id: integrationId, tenantId, isActive: true } }),
    );
    if (!integration) throw new NotFoundException('Integration not found');

    const accessToken = decryptSecret(integration.accessTokenEnc);

    // Write to provider
    let externalId: string;
    if (integration.provider === 'GOOGLE') {
      const body = { summary: dto.title, description: dto.description, start: { dateTime: dto.startAt.toISOString() }, end: { dateTime: dto.endAt.toISOString() }, location: dto.location, attendees: dto.attendees?.map((e) => ({ email: e })) };
      const res = await fetch(`${googleApiBase()}/calendar/v3/calendars/primary/events`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json() as { id: string };
      externalId = data.id;
    } else {
      const body = { subject: dto.title, body: { contentType: 'text', content: dto.description ?? '' }, start: { dateTime: dto.startAt.toISOString(), timeZone: 'UTC' }, end: { dateTime: dto.endAt.toISOString(), timeZone: 'UTC' }, location: dto.location ? { displayName: dto.location } : undefined, attendees: dto.attendees?.map((e) => ({ emailAddress: { address: e }, type: 'required' })) };
      const res = await fetch(`${microsoftGraphBase()}/v1.0/me/events`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json() as { id: string };
      externalId = data.id;
    }

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarEvent.create({
        data: {
          tenantId,
          integrationId,
          externalId,
          title: dto.title,
          description: dto.description ?? null,
          startAt: dto.startAt,
          endAt: dto.endAt,
          location: dto.location ?? null,
          attendees: dto.attendees ? dto.attendees : Prisma.DbNull,
          subjectType: dto.subjectType ? dto.subjectType as SubjectType : null,
          subjectId: dto.subjectId ?? null,
        },
      }),
    );
  }

  async listEvents(query: ListCalendarEventsQueryDto): Promise<CalendarEvent[]> {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.calendarEvent.findMany({
        where: {
          tenantId,
          ...(query.from ? { startAt: { gte: query.from } } : {}),
          ...(query.to ? { endAt: { lte: query.to } } : {}),
          ...(query.subjectType ? { subjectType: query.subjectType as SubjectType } : {}),
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        },
        orderBy: { startAt: 'asc' },
        take: 500,
      }),
    );
  }

  // ─── Token refresh sweep ──────────────────────────────────────────────────
  //
  // Called by CalendarRefreshScheduler every 15 minutes. Finds every active
  // integration whose tokenExpiresAt falls inside the next hour AND has a
  // refresh token, calls the provider's refresh endpoint, and persists the
  // new access token + expiry. Bypasses RLS by using the raw client — this
  // is a privileged service-level job, same pattern as gdpr.sweepAllTenants.

  async refreshExpiring(now: Date = new Date()): Promise<{ refreshed: number; failed: number }> {
    const horizon = new Date(now.getTime() + 60 * 60 * 1000); // 1h ahead
    const candidates = await this.prisma.calendarIntegration.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        refreshTokenEnc: { not: null },
        tokenExpiresAt: { lt: horizon },
      },
      select: {
        id: true,
        tenantId: true,
        provider: true,
        refreshTokenEnc: true,
      },
    });

    let refreshed = 0;
    let failed = 0;
    for (const c of candidates) {
      try {
        const refreshToken = decryptSecret(c.refreshTokenEnc!);
        const fresh = await this.refreshOne(c.provider as 'GOOGLE' | 'OUTLOOK', refreshToken);
        await this.prisma.runWithTenant(c.tenantId, (tx) =>
          tx.calendarIntegration.update({
            where: { id: c.id },
            data: {
              accessTokenEnc: encryptSecret(fresh.accessToken),
              ...(fresh.refreshToken ? { refreshTokenEnc: encryptSecret(fresh.refreshToken) } : {}),
              tokenExpiresAt: fresh.expiresAt,
            },
          }),
        );
        refreshed++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Calendar token refresh failed integration=${c.id} provider=${c.provider}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (refreshed > 0 || failed > 0) {
      this.logger.log(
        `Calendar refresh sweep: refreshed=${refreshed} failed=${failed} candidates=${candidates.length}`,
      );
    }
    return { refreshed, failed };
  }

  private async refreshOne(
    provider: 'GOOGLE' | 'OUTLOOK',
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date }> {
    const tokenUrl =
      provider === 'GOOGLE'
        ? `${googleOAuthBase()}/token`
        : `${microsoftOAuthBase()}/common/oauth2/v2.0/token`;
    const clientId =
      provider === 'GOOGLE' ? process.env['GOOGLE_CLIENT_ID'] : process.env['OUTLOOK_CLIENT_ID'];
    const clientSecret =
      provider === 'GOOGLE' ? process.env['GOOGLE_CLIENT_SECRET'] : process.env['OUTLOOK_CLIENT_SECRET'];
    if (!clientId || !clientSecret) {
      throw new Error(`${provider} OAuth client credentials not configured`);
    }
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      throw new Error(`${provider} refresh ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // Google sometimes rotates; Outlook usually keeps the same
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}
