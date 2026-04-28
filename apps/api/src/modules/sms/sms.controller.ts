import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SmsService } from './sms.service';

const SendSmsSchema = z.object({
  toNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 format'),
  body: z.string().min(1).max(1600),
  contactId: z.string().optional(),
});

@Controller('sms')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
export class SmsController {
  constructor(private readonly svc: SmsService) {}

  @Post('send')
  @RequireCedar({ action: 'sms::send', resource: 'Sms::*' })
  send(@Body(new ZodValidationPipe(SendSmsSchema)) dto: { toNumber: string; body: string; contactId?: string }) {
    return this.svc.send(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query('contactId') contactId?: string) {
    return this.svc.listMessages(contactId);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  get(@Param('id') id: string) {
    return this.svc.getMessage(id);
  }
}
