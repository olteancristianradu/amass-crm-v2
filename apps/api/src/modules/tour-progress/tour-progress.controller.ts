import { Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { TourProgressService } from './tour-progress.service';

/**
 * Per-user product tour state. Authenticated only — no role gate (every
 * user has their own tour state). Tours themselves are FE concerns; this
 * just persists which IDs each user has completed.
 */
@Controller('tour-progress')
@UseGuards(JwtAuthGuard)
export class TourProgressController {
  constructor(private readonly svc: TourProgressService) {}

  @Get('completed')
  async getCompleted(): Promise<{ completedTours: string[] }> {
    const tours = await this.svc.getCompletedTours();
    return { completedTours: tours };
  }

  @Post(':tourId/complete')
  @HttpCode(200)
  async markComplete(@Param('tourId') tourId: string): Promise<{ completedTours: string[] }> {
    const tours = await this.svc.markCompleted(tourId);
    return { completedTours: tours };
  }

  @Delete(':tourId/complete')
  @HttpCode(200)
  async markIncomplete(@Param('tourId') tourId: string): Promise<{ completedTours: string[] }> {
    const tours = await this.svc.markIncomplete(tourId);
    return { completedTours: tours };
  }
}
