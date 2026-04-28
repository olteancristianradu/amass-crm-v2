import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { LeadScoringService } from './lead-scoring.service';

@Controller('lead-scoring')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
export class LeadScoringController {
  constructor(private readonly svc: LeadScoringService) {}

  @Get('company/:id')
  getCompanyScore(@Param('id') id: string) {
    return this.svc.getScore('company', id);
  }

  @Get('contact/:id')
  getContactScore(@Param('id') id: string) {
    return this.svc.getScore('contact', id);
  }

  @Post('company/:id/recompute')
  @RequireCedar({
    action: 'lead-score::recompute',
    resource: (req) => `Company::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  recomputeCompany(@Param('id') id: string) {
    return this.svc.requestRecompute('company', id);
  }

  @Post('contact/:id/recompute')
  @RequireCedar({
    action: 'lead-score::recompute',
    resource: (req) => `Contact::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  recomputeContact(@Param('id') id: string) {
    return this.svc.requestRecompute('contact', id);
  }
}
