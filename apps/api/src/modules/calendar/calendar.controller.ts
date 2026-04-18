import {
  Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Redirect, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CalendarProviderSchema,
  CreateCalendarEventSchema, CreateCalendarEventDto,
  ListCalendarEventsQuerySchema, ListCalendarEventsQueryDto,
} from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
export class CalendarController {
  constructor(private readonly svc: CalendarService) {}

  @Get('integrations')
  listIntegrations() { return this.svc.listIntegrations(); }

  @Get('connect/:provider')
  @Redirect()
  connect(@Param('provider') rawProvider: string, @Query('redirectUri') redirectUri: string) {
    const provider = CalendarProviderSchema.parse(rawProvider.toUpperCase());
    const url = this.svc.buildAuthUrl(provider, redirectUri ?? `${process.env['API_BASE_URL']}/api/v1/calendar/callback/${provider}`);
    return { url };
  }

  @Get('callback/:provider')
  async callback(
    @Param('provider') rawProvider: string,
    @Query('code') code: string,
    @Query('redirectUri') redirectUri: string,
  ) {
    const provider = CalendarProviderSchema.parse(rawProvider.toUpperCase());
    const uri = redirectUri ?? `${process.env['API_BASE_URL']}/api/v1/calendar/callback/${provider}`;
    const tokens = await this.svc.exchangeCode(provider, code, uri);
    const integration = await this.svc.saveIntegration(provider, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
    return { message: 'Connected', integrationId: integration.id };
  }

  @Delete('integrations/:id')
  @HttpCode(204)
  disconnect(@Param('id') id: string) { return this.svc.disconnect(id); }

  @Post('integrations/:id/sync')
  @HttpCode(200)
  sync(@Param('id') id: string) { return this.svc.sync(id); }

  @Get('events')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listEvents(@Query(new ZodValidationPipe(ListCalendarEventsQuerySchema)) q: ListCalendarEventsQueryDto) {
    return this.svc.listEvents(q);
  }

  @Post('integrations/:id/events')
  createEvent(
    @Param('id') integrationId: string,
    @Body(new ZodValidationPipe(CreateCalendarEventSchema)) dto: CreateCalendarEventDto,
  ) { return this.svc.createEvent(integrationId, dto); }
}
