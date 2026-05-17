import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { UserRole, WebhookEvent } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { WebhooksService } from './webhooks.service';

const WebhookEventSchema = z.nativeEnum(WebhookEvent);

// Empty events array = "subscribe to all events" per FE convention shown
// in the listing UI ("Evenimente: toate" when length === 0). The min(1)
// constraint was rejecting that intent with a 400 even though semantically
// "no filter" is valid.
const CreateEndpointSchema = z.object({
  url: z.string().url(),
  events: z.array(WebhookEventSchema),
});

const UpdateEndpointSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(WebhookEventSchema).optional(),
  isActive: z.boolean().optional(),
});

@Controller('webhooks')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Post('endpoints')
  @RequireCedar({ action: 'webhook::create', resource: 'WebhookEndpoint::new' })
  create(@Body(new ZodValidationPipe(CreateEndpointSchema)) dto: { url: string; events: WebhookEvent[] }) {
    return this.svc.create(dto);
  }

  @Get('endpoints')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  list() {
    return this.svc.list();
  }

  @Get('endpoints/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch('endpoints/:id')
  @RequireCedar({ action: 'webhook::update', resource: (req) => `WebhookEndpoint::${(req as { params: { id: string } }).params.id}` })
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEndpointSchema)) dto: { url?: string; events?: WebhookEvent[]; isActive?: boolean },
  ) {
    return this.svc.update(id, dto);
  }

  @Delete('endpoints/:id')
  @HttpCode(204)
  @RequireCedar({ action: 'webhook::delete', resource: (req) => `WebhookEndpoint::${(req as { params: { id: string } }).params.id}` })
  delete(@Param('id') id: string) {
    return this.svc.delete(id);
  }

  // SEC-008: secret is shown once at create. Use this endpoint to rotate
  // when a tenant suspects leak — returns the new secret exactly once.
  @Post('endpoints/:id/rotate-secret')
  @RequireCedar({ action: 'webhook::update', resource: (req) => `WebhookEndpoint::${(req as { params: { id: string } }).params.id}` })
  rotateSecret(@Param('id') id: string) {
    return this.svc.rotateSecret(id);
  }

  // HIGH-6 (Phase 1.1, T-WH-I-03): MANAGER dropped — delivery logs include
  // the full payload sent to subscribers, which can contain PII-adjacent
  // business data (deal amounts, customer email, invoice totals). Limit to
  // OWNER + ADMIN who are responsible for webhook configuration anyway.
  @Get('endpoints/:id/deliveries')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  deliveries(@Param('id') id: string) {
    return this.svc.listDeliveries(id);
  }
}
