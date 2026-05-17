import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EmailTrackingService } from './email-tracking.service';

/**
 * Email tracking endpoints.
 *
 * Public (no auth):
 *   GET /e/t/:id/open.gif?s=...        — open-pixel (HMAC-signed in Phase 1)
 *   GET /e/t/:id/click?u=...&s=...     — click redirect (HMAC-signed)
 *   GET /e/u/:token                    — one-click unsubscribe (Phase 1)
 *
 * Authenticated:
 *   GET /email/:id/tracking            — stats for an EmailMessage
 */
@Controller()
export class EmailTrackingController {
  constructor(private readonly tracking: EmailTrackingService) {}

  @Get('e/t/:id/open.gif')
  @Public()
  async open(
    @Param('id') id: string,
    @Query('s') s: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { ip, ua } = extractIpUa(req);
    // Phase 1 (T-MAIL-S-01): pixel URLs now carry an HMAC signature. Service
    // validates and silently no-ops on bad/missing sig (returns the pixel
    // regardless, so probes can't distinguish real from forged messageIds).
    const bytes = await this.tracking.recordOpen(id, s ?? null, ip, ua);
    res
      .status(200)
      .setHeader('Content-Type', 'image/gif')
      .setHeader('Cache-Control', 'no-store, max-age=0')
      .setHeader('Content-Length', String(bytes.length))
      .end(bytes);
  }

  @Get('e/t/:id/click')
  @Public()
  async click(
    @Param('id') id: string,
    @Query('u') u: string,
    @Query('s') s: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { ip, ua } = extractIpUa(req);
    // `s` is the HMAC signature added by injectTracking. Required by default
    // (see EMAIL_TRACKING_REQUIRE_SIG env). Defeats open-redirect attacks
    // where an attacker who knows a messageId crafts ?u=https://phishing.
    const target = await this.tracking.recordClick(id, u ?? '', s ?? null, ip, ua);
    if (!target) {
      res.status(404).json({ code: 'TRACKING_LINK_INVALID', message: 'Link not found' });
      return;
    }
    res.redirect(302, target);
  }

  /**
   * Phase 1 F1 / T-MAIL-E-02 + spec D9 — one-click unsubscribe.
   *
   * Public endpoint hit when the recipient clicks the unsubscribe link in
   * the email footer (or when their mail client honours the
   * List-Unsubscribe header with HTTP method). The token is HMAC-protected:
   * forgery without our JWT_SECRET is computationally infeasible.
   *
   * On success: writes EmailTrack kind=UNSUBSCRIBE + adds recipient email
   * to the EmailSuppression list with reason=USER_UNSUBSCRIBE + serves a
   * minimal HTML confirmation page (RO + EN, no JS, inline CSS so it
   * renders in walled-garden previewers).
   *
   * On any verification failure: 404 with no detail — we don't want to
   * help an attacker probe valid message IDs.
   */
  @Get('e/u/:token')
  @Public()
  async unsubscribe(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const out = await this.tracking.recordUnsubscribe(token);
    if (!out) {
      res
        .status(404)
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .send(renderUnsubFailureHtml());
      return;
    }
    res
      .status(200)
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'no-store, max-age=0')
      .send(renderUnsubSuccessHtml(out.emailMasked));
  }

  @Get('email/:id/tracking')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  stats(@Param('id') id: string) {
    return this.tracking.statsForMessage(id);
  }
}

function extractIpUa(req: Request): { ip: string | null; ua: string | null } {
  const xff = req.headers['x-forwarded-for'];
  const fromXff = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
  const ip = fromXff || req.ip || null;
  const uaRaw = req.headers['user-agent'];
  const ua = Array.isArray(uaRaw) ? uaRaw[0] : uaRaw ?? null;
  return { ip: ip ?? null, ua: ua ?? null };
}

// ─── Static HTML responses for the unsubscribe public endpoint ─────────────
//
// We render bilingual RO/EN inline — no template engine, no JS, no external
// CSS — because the page may render inside a webmail iframe or a mail-client
// preview that strips scripts and external resources. Inline CSS works
// everywhere; <details>/<summary> works in every modern mail client.

function renderUnsubSuccessHtml(emailMasked: string): string {
  const safeMasked = emailMasked.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Dezabonare reușită · Unsubscribed</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f8fa;padding:32px;color:#1f2328">
  <div style="max-width:560px;margin:48px auto;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">Dezabonare confirmată</h1>
    <p style="margin:0 0 12px;color:#57606a">
      Adresa <strong>${safeMasked}</strong> a fost adăugată în lista noastră de „nu mai trimite". Nu vei mai primi e-mailuri de marketing.
    </p>
    <p style="margin:0 0 24px;color:#57606a">
      E-mailurile tranzacționale (de exemplu confirmări de cont sau facturi) pot continua dacă încă ai un cont activ.
    </p>
    <hr style="border:none;border-top:1px solid #d0d7de;margin:24px 0" />
    <h2 style="margin:0 0 8px;font-size:16px">Unsubscribed</h2>
    <p style="margin:0;color:#57606a">
      The address <strong>${safeMasked}</strong> has been added to our suppression list. You will no longer receive marketing emails.
      Transactional emails (account confirmations, invoices) may still arrive if you have an active account.
    </p>
  </div>
</body>
</html>`;
}

function renderUnsubFailureHtml(): string {
  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Link expirat · Link expired</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f8fa;padding:32px;color:#1f2328">
  <div style="max-width:560px;margin:48px auto;background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:32px">
    <h1 style="margin:0 0 16px;font-size:20px">Link invalid sau expirat</h1>
    <p style="margin:0 0 24px;color:#57606a">
      Acest link de dezabonare nu mai este valid. Te rugăm să cauți un e-mail mai recent sau să contactezi suportul.
    </p>
    <hr style="border:none;border-top:1px solid #d0d7de;margin:24px 0" />
    <h2 style="margin:0 0 8px;font-size:16px">Invalid or expired link</h2>
    <p style="margin:0;color:#57606a">
      This unsubscribe link is no longer valid. Please look for a more recent email or contact support.
    </p>
  </div>
</body>
</html>`;
}
