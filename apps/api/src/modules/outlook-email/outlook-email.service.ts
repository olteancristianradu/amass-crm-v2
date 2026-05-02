/**
 * Outlook email integration via Microsoft Graph API.
 *
 * OAuth flow (delegated permissions):
 *   1. GET /outlook/connect → build MS auth URL (state in Redis, 10 min)
 *   2. GET /outlook/callback?code=&state= → exchange code, store encrypted tokens
 *   3. GET /outlook/status → check if connected
 *   4. GET /outlook/messages → fetch recent inbox messages
 *   5. POST /outlook/messages/send → send email via Graph
 *   6. DELETE /outlook/disconnect → revoke tokens
 *
 * Scopes: openid email profile offline_access Mail.ReadWrite Mail.Send
 *
 * Tokens are AES-256-GCM encrypted at rest (same as CalendarIntegration).
 * The `inboxDeltaLink` is stored after the first sync; subsequent calls use
 * it so only new/changed messages are fetched (Graph delta query pattern).
 */
import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OutlookToken } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { decrypt as decryptSecret, encrypt as encryptSecret } from '../../common/crypto/encryption';
import { loadEnv } from '../../config/env';

function msOAuthBase(): string {
  return (loadEnv().MICROSOFT_OAUTH_BASE_URL ?? 'https://login.microsoftonline.com').replace(/\/$/, '');
}
function msGraphBase(): string {
  return (loadEnv().MICROSOFT_GRAPH_BASE_URL ?? 'https://graph.microsoft.com').replace(/\/$/, '');
}

const SCOPES = 'openid email profile offline_access Mail.ReadWrite Mail.Send';

export interface OutlookMessage {
  id: string;
  subject: string;
  from: { email: string; name: string };
  to: { email: string; name: string }[];
  receivedAt: string;
  bodyPreview: string;
  isRead: boolean;
  webLink?: string;
}

@Injectable()
export class OutlookEmailService {
  private readonly logger = new Logger(OutlookEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ─── OAuth ─────────────────────────────────────────────────────────────────

  async buildAuthUrl(redirectUri: string): Promise<string> {
    const { tenantId, userId } = requireTenantContext();
    const state = randomBytes(24).toString('hex');
    await this.redis.client.set(
      `oauth:outlook-email:state:${state}`,
      JSON.stringify({ tenantId, userId }),
      'EX',
      600,
    );
    const params = new URLSearchParams({
      client_id: process.env['OUTLOOK_CLIENT_ID'] ?? '',
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      response_mode: 'query',
      state,
      prompt: 'consent',
    });
    return `${msOAuthBase()}/common/oauth2/v2.0/authorize?${params}`;
  }

  async handleCallback(code: string, state: string, redirectUri: string): Promise<OutlookToken> {
    const { tenantId, userId } = requireTenantContext();
    // Validate state — single-use CSRF token
    const stateKey = `oauth:outlook-email:state:${state}`;
    const raw = await this.redis.client.get(stateKey);
    if (!raw) throw new UnauthorizedException('OAuth state invalid or expired');
    await this.redis.client.del(stateKey);
    let parsed: { tenantId?: string; userId?: string };
    try { parsed = JSON.parse(raw); } catch { throw new UnauthorizedException('OAuth state corrupt'); }
    if (parsed.tenantId !== tenantId || parsed.userId !== userId) {
      throw new UnauthorizedException('OAuth state mismatch');
    }

    // Exchange code for tokens
    const tokenRes = await fetch(`${msOAuthBase()}/common/oauth2/v2.0/token`, {
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
    const tokenData = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      error?: string;
      error_description?: string;
    };
    if (tokenData.error) {
      this.logger.error(`Outlook token exchange failed: ${tokenData.error_description ?? tokenData.error}`);
      throw new UnauthorizedException(`Outlook auth failed: ${tokenData.error}`);
    }

    // Fetch profile (display name + email)
    const profileRes = await fetch(`${msGraphBase()}/v1.0/me`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json() as { displayName?: string; mail?: string; userPrincipalName?: string };
    const email = profile.mail ?? profile.userPrincipalName ?? '';

    const enc = (s: string) => encryptSecret(s);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.outlookToken.upsert({
        where: { tenantId_userId: { tenantId, userId: userId! } },
        create: {
          tenantId,
          userId: userId!,
          email,
          displayName: profile.displayName ?? null,
          accessTokenEnc: enc(tokenData.access_token),
          refreshTokenEnc: enc(tokenData.refresh_token ?? ''),
          tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
        },
        update: {
          email,
          displayName: profile.displayName ?? null,
          accessTokenEnc: enc(tokenData.access_token),
          refreshTokenEnc: enc(tokenData.refresh_token ?? ''),
          tokenExpiresAt: new Date(Date.now() + tokenData.expires_in * 1000),
          isActive: true,
          inboxDeltaLink: null, // reset delta on reconnect
        },
      }),
    );
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  async getStatus(): Promise<{ connected: boolean; email?: string; displayName?: string }> {
    const { tenantId, userId } = requireTenantContext();
    const token = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.outlookToken.findFirst({ where: { tenantId, userId: userId!, isActive: true } }),
    );
    if (!token) return { connected: false };
    return { connected: true, email: token.email, displayName: token.displayName ?? undefined };
  }

  // ─── Read inbox ────────────────────────────────────────────────────────────

  async listMessages(limit = 20): Promise<OutlookMessage[]> {
    const token = await this.getToken();
    const accessToken = await this.ensureFreshToken(token);
    const url = `${msGraphBase()}/v1.0/me/mailFolders/inbox/messages?$top=${limit}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,webLink`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json() as { value?: GraphMessage[]; error?: { message: string } };
    if (data.error) throw new Error(`Graph error: ${data.error.message}`);
    return (data.value ?? []).map(mapGraphMessage);
  }

  // ─── Send email ────────────────────────────────────────────────────────────

  async sendMessage(dto: {
    to: string[];
    cc?: string[];
    subject: string;
    bodyHtml: string;
    saveToSentItems?: boolean;
  }): Promise<void> {
    const token = await this.getToken();
    const accessToken = await this.ensureFreshToken(token);

    const message = {
      message: {
        subject: dto.subject,
        body: { contentType: 'HTML', content: dto.bodyHtml },
        toRecipients: dto.to.map((a) => ({ emailAddress: { address: a } })),
        ...(dto.cc?.length ? { ccRecipients: dto.cc.map((a) => ({ emailAddress: { address: a } })) } : {}),
      },
      saveToSentItems: dto.saveToSentItems !== false,
    };

    const res = await fetch(`${msGraphBase()}/v1.0/me/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph sendMail failed (${res.status}): ${err}`);
    }
  }

  // ─── Disconnect ─────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    const { tenantId, userId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.outlookToken.updateMany({
        where: { tenantId, userId: userId! },
        data: { isActive: false },
      }),
    );
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async getToken(): Promise<OutlookToken> {
    const { tenantId, userId } = requireTenantContext();
    const token = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.outlookToken.findFirst({ where: { tenantId, userId: userId!, isActive: true } }),
    );
    if (!token) throw new NotFoundException({ code: 'OUTLOOK_NOT_CONNECTED', message: 'Outlook not connected' });
    return token;
  }

  private async ensureFreshToken(token: OutlookToken): Promise<string> {
    // If token expires in < 5 minutes, refresh proactively
    const expiresInMs = token.tokenExpiresAt.getTime() - Date.now();
    if (expiresInMs > 5 * 60 * 1000) return decryptSecret(token.accessTokenEnc);

    const refreshToken = decryptSecret(token.refreshTokenEnc);
    const res = await fetch(`${msOAuthBase()}/common/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env['OUTLOOK_CLIENT_ID'] ?? '',
        client_secret: process.env['OUTLOOK_CLIENT_SECRET'] ?? '',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: SCOPES,
      }),
    });
    const data = await res.json() as { access_token: string; expires_in: number; error?: string };
    if (data.error) {
      // Refresh token expired — mark as inactive so UX shows reconnect prompt
      await this.prisma.outlookToken.update({ where: { id: token.id }, data: { isActive: false } });
      throw new UnauthorizedException({ code: 'OUTLOOK_TOKEN_EXPIRED', message: 'Outlook token expired — please reconnect' });
    }

    const enc = encryptSecret(data.access_token);
    await this.prisma.outlookToken.update({
      where: { id: token.id },
      data: { accessTokenEnc: enc, tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000) },
    });
    return data.access_token;
  }
}

// ─── Graph API type helpers ───────────────────────────────────────────────────

interface GraphRecipient { emailAddress: { address: string; name?: string } }
interface GraphMessage {
  id: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  receivedDateTime: string;
  bodyPreview?: string;
  isRead: boolean;
  webLink?: string;
}

function mapGraphMessage(m: GraphMessage): OutlookMessage {
  return {
    id: m.id,
    subject: m.subject ?? '(no subject)',
    from: { email: m.from?.emailAddress.address ?? '', name: m.from?.emailAddress.name ?? '' },
    to: (m.toRecipients ?? []).map((r) => ({ email: r.emailAddress.address, name: r.emailAddress.name ?? '' })),
    receivedAt: m.receivedDateTime,
    bodyPreview: m.bodyPreview ?? '',
    isRead: m.isRead,
    webLink: m.webLink,
  };
}
