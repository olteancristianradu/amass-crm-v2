import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CreateWhatsappAccountSchema, CreateWhatsappAccountDto, SendWhatsappMessageSchema, SendWhatsappMessageDto } from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly svc: WhatsappService) {}

  // ─── Account management (authenticated) ───────────────────────────────────

  @Get('accounts')
  @UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  listAccounts() { return this.svc.listAccounts(); }

  @Post('accounts')
  @UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
  @RequireCedar({ action: 'whatsapp::create', resource: 'WhatsappAccount::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createAccount(@Body(new ZodValidationPipe(CreateWhatsappAccountSchema)) dto: CreateWhatsappAccountDto) {
    return this.svc.createAccount(dto);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
  @RequireCedar({
    action: 'whatsapp::delete',
    resource: (req) => `WhatsappAccount::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  removeAccount(@Param('id') id: string) { return this.svc.removeAccount(id); }

  // ─── Send ──────────────────────────────────────────────────────────────────

  @Post('messages')
  @UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
  @RequireCedar({ action: 'whatsapp::send', resource: 'WhatsappMessage::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  send(@Body(new ZodValidationPipe(SendWhatsappMessageSchema)) dto: SendWhatsappMessageDto) {
    return this.svc.send(dto);
  }

  @Get('messages')
  @UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listMessages(
    @Query('subjectType') subjectType: string,
    @Query('subjectId') subjectId: string,
  ) { return this.svc.listMessages(subjectType, subjectId); }

  // ─── Meta Webhook (public) ─────────────────────────────────────────────────
  // M-8: throttle both handlers per-IP. Meta's normal traffic is orders of
  // magnitude below these limits; the cap exists to absorb replay floods
  // from spoofed sources — signature validation still rejects them, but
  // we don't want to burn CPU hashing garbage at line rate.

  @Get('webhook')
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  verifyWebhook(
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.mode') mode: string,
    @Query('tenantId') tenantId: string,
  ) {
    if (mode !== 'subscribe') return 'forbidden';
    // M-aud-M1: previously the controller passed `verifyToken` as both
    // the candidate AND the expected value, so `if (a !== a)` was always
    // false and anybody completed the Meta verification handshake. Now
    // we hand the tenantId off to the service which loads the account's
    // own `webhookVerifyToken` from the DB and does the real comparison.
    return this.svc.verifyWebhook(tenantId, verifyToken, challenge);
  }

  @Post('webhook')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  async receiveWebhook(
    @Req() req: Request,
    @Query('tenantId') tenantId: string,
  ) {
    const sig = req.headers['x-hub-signature-256'] as string ?? '';
    try {
      await this.svc.handleWebhook(tenantId, req.body, sig);
    } catch {
      // Swallow errors — Meta retries on non-200; we must always return 200
    }
    return { status: 'ok' };
  }
}
