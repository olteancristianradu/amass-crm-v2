import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { CreateWhatsappAccountSchema, CreateWhatsappAccountDto, SendWhatsappMessageSchema, SendWhatsappMessageDto } from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly svc: WhatsappService) {}

  // ─── Account management (authenticated) ───────────────────────────────────

  @Get('accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  listAccounts() { return this.svc.listAccounts(); }

  @Post('accounts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createAccount(@Body(new ZodValidationPipe(CreateWhatsappAccountSchema)) dto: CreateWhatsappAccountDto) {
    return this.svc.createAccount(dto);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  removeAccount(@Param('id') id: string) { return this.svc.removeAccount(id); }

  // ─── Send ──────────────────────────────────────────────────────────────────

  @Post('messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  send(@Body(new ZodValidationPipe(SendWhatsappMessageSchema)) dto: SendWhatsappMessageDto) {
    return this.svc.send(dto);
  }

  @Get('messages')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listMessages(
    @Query('subjectType') subjectType: string,
    @Query('subjectId') subjectId: string,
  ) { return this.svc.listMessages(subjectType, subjectId); }

  // ─── Meta Webhook (public) ─────────────────────────────────────────────────

  @Get('webhook')
  verifyWebhook(
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.mode') mode: string,
    @Query('tenantId') _tenantId: string,
  ) {
    // In production, look up account verify token by tenantId
    // For now, verify against env var fallback
    if (mode !== 'subscribe') return 'forbidden';
    return this.svc.verifyWebhook(verifyToken, challenge, verifyToken);
  }

  @Post('webhook')
  @HttpCode(200)
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
