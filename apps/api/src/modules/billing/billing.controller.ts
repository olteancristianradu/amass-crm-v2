import {
  Body, Controller, Get, HttpCode, Post, RawBodyRequest, Req, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { BillingService } from './billing.service';

const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'growth', 'enterprise']),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

const PortalSchema = z.object({
  returnUrl: z.string().url(),
});

@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Get('subscription')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  getSubscription() {
    return this.svc.getSubscription();
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  checkout(@Body(new ZodValidationPipe(CheckoutSchema)) dto: { plan: string; successUrl: string; cancelUrl: string }) {
    return this.svc.createCheckoutSession(dto.plan, dto.successUrl, dto.cancelUrl);
  }

  @Post('portal')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER)
  portal(@Body(new ZodValidationPipe(PortalSchema)) dto: { returnUrl: string }) {
    return this.svc.createBillingPortalSession(dto.returnUrl);
  }

  /** Raw body required for Stripe webhook signature verification. */
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>) {
    return this.svc.handleWebhook(req);
  }
}
