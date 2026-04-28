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
 *   GET /e/t/:id/open.gif       — open-pixel
 *   GET /e/t/:id/click?u=...    — click redirect
 *
 * Authenticated:
 *   GET /email/:id/tracking     — stats for an EmailMessage
 */
@Controller()
export class EmailTrackingController {
  constructor(private readonly tracking: EmailTrackingService) {}

  @Get('e/t/:id/open.gif')
  @Public()
  async open(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { ip, ua } = extractIpUa(req);
    const bytes = await this.tracking.recordOpen(id, ip, ua);
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
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { ip, ua } = extractIpUa(req);
    const target = await this.tracking.recordClick(id, u ?? '', ip, ua);
    if (!target) {
      res.status(404).json({ code: 'TRACKING_LINK_INVALID', message: 'Link not found' });
      return;
    }
    res.redirect(302, target);
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
