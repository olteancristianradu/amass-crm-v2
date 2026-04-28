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
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CalendarService } from './calendar.service';

@Controller('calendar')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
export class CalendarController {
  constructor(private readonly svc: CalendarService) {}

  @Get('integrations')
  listIntegrations() { return this.svc.listIntegrations(); }

  @Get('connect/:provider')
  @Redirect()
  async connect(@Param('provider') rawProvider: string, @Query('redirectUri') redirectUri: string) {
    const provider = CalendarProviderSchema.parse(rawProvider.toUpperCase());
    const url = await this.svc.buildAuthUrl(provider, redirectUri ?? `${process.env['API_BASE_URL']}/api/v1/calendar/callback/${provider}`);
    return { url };
  }

  @Get('callback/:provider')
  async callback(
    @Param('provider') rawProvider: string,
    @Query('code') code: string,
    @Query('redirectUri') redirectUri: string,
    @Query('state') state: string,
  ) {
    const provider = CalendarProviderSchema.parse(rawProvider.toUpperCase());
    // M-aud-H8: refuse the callback unless state matches a value we issued
    // for THIS user in connect/. CSRF mitigation per OAuth 2.0 §10.12.
    await this.svc.consumeOAuthState(state, provider);
    const uri = redirectUri ?? `${process.env['API_BASE_URL']}/api/v1/calendar/callback/${provider}`;
    const tokens = await this.svc.exchangeCode(provider, code, uri);
    const integration = await this.svc.saveIntegration(provider, tokens.accessToken, tokens.refreshToken, tokens.expiresAt);
    return { message: 'Connected', integrationId: integration.id };
  }

  @Delete('integrations/:id')
  @HttpCode(204)
  @RequireCedar({
    action: 'calendar::delete',
    resource: (req) => `CalendarIntegration::${(req as { params: { id: string } }).params.id}`,
  })
  disconnect(@Param('id') id: string) { return this.svc.disconnect(id); }

  @Post('integrations/:id/sync')
  @HttpCode(200)
  @RequireCedar({
    action: 'calendar::sync',
    resource: (req) => `CalendarIntegration::${(req as { params: { id: string } }).params.id}`,
  })
  sync(@Param('id') id: string) { return this.svc.sync(id); }

  @Get('events')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listEvents(@Query(new ZodValidationPipe(ListCalendarEventsQuerySchema)) q: ListCalendarEventsQueryDto) {
    return this.svc.listEvents(q);
  }

  @Post('integrations/:id/events')
  @RequireCedar({
    action: 'calendar::create',
    resource: (req) => `CalendarIntegration::${(req as { params: { id: string } }).params.id}`,
  })
  createEvent(
    @Param('id') integrationId: string,
    @Body(new ZodValidationPipe(CreateCalendarEventSchema)) dto: CreateCalendarEventDto,
  ) { return this.svc.createEvent(integrationId, dto); }
}
