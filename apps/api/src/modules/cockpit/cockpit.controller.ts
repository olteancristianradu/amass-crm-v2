import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CockpitService } from './cockpit.service';

/**
 * Pro Cockpit — actionable home screen.
 *
 * GET /api/v1/cockpit/feed
 *   Returns ranked items across deals-in-danger, reminders-due-today,
 *   tasks-overdue. The FE renders selectable widgets that filter the
 *   feed by `widget` field; per-widget layout persistence is a future
 *   enhancement (currently localStorage on the FE).
 */
@Controller('cockpit')
@UseGuards(JwtAuthGuard)
export class CockpitController {
  constructor(private readonly svc: CockpitService) {}

  @Get('feed')
  feed() {
    return this.svc.feed();
  }
}
