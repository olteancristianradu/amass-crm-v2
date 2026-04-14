import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

/**
 * Reports endpoints:
 *   GET /reports/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /reports/deals-trend?from=...&to=...
 */
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  dashboard(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Default: last 30 days
    const now = new Date();
    const toDate = to ?? now.toISOString().slice(0, 10);
    const fromDate = from ?? new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    return this.reports.dashboard(fromDate, toDate);
  }

  @Get('deals-trend')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  dealsTrend(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const toDate = to ?? now.toISOString().slice(0, 10);
    const fromDate = from ?? new Date(now.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    return this.reports.dealsTrend(fromDate, toDate);
  }
}
