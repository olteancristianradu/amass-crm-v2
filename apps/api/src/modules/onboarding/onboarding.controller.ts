import { Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { OnboardingService } from './onboarding.service';

/**
 * F1.9 — Tenant onboarding endpoints.
 *
 * Status: any authenticated team member can read (FE may want to show
 * progress badges).
 * Mark complete + load sample: OWNER only — ADMIN deliberately excluded so
 * a junior admin cannot accidentally seed test data into a real tenant.
 */
@Controller('onboarding')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get('status')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  @RequireCedar({ action: 'onboarding::read', resource: 'TenantConfig::self' })
  status() {
    return this.svc.getStatus();
  }

  @Post('complete')
  @HttpCode(200)
  @Roles(UserRole.OWNER)
  @RequireCedar({ action: 'onboarding::complete', resource: 'TenantConfig::self' })
  complete() {
    return this.svc.markComplete();
  }

  @Post('load-sample-data')
  @HttpCode(200)
  @Roles(UserRole.OWNER)
  @RequireCedar({ action: 'onboarding::load-sample-data', resource: 'TenantConfig::self' })
  loadSample() {
    return this.svc.loadSampleData();
  }
}
