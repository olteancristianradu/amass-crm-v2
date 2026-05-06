import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CockpitLayoutService, CockpitService } from './cockpit.service';

const LayoutSchema = z.object({
  widgets: z.array(z.string()).max(10),
});

/**
 * Pro Cockpit — actionable home screen.
 *
 * GET  /api/v1/cockpit/feed   — ranked items across widgets
 * GET  /api/v1/cockpit/layout — current user's widget layout
 * PUT  /api/v1/cockpit/layout — replace user's widget layout
 *
 * Layout falls back to localStorage on the FE when these endpoints are
 * unavailable.
 */
@Controller('cockpit')
@UseGuards(JwtAuthGuard)
export class CockpitController {
  constructor(
    private readonly svc: CockpitService,
    private readonly layouts: CockpitLayoutService,
  ) {}

  @Get('feed')
  feed() {
    return this.svc.feed();
  }

  @Get('layout')
  getLayout() {
    return this.layouts.get();
  }

  @Put('layout')
  saveLayout(@Body() body: unknown) {
    const parsed = LayoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_LAYOUT',
        message: parsed.error.errors[0]?.message ?? 'Invalid layout body',
      });
    }
    return this.layouts.upsert(parsed.data.widgets);
  }
}
