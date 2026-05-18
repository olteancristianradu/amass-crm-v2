import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { SendForSignatureSchema } from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { EsignEnabledGuard } from './esign-enabled.guard';
import { CeremonyService } from './ceremony.service';

/**
 * Phase 2 F1 — owner-side ceremony endpoints. JWT + role + Cedar gated.
 * The feature-flag guard (EsignEnabledGuard) fires first so a disabled
 * flag returns 503 before any business logic runs.
 *
 * Mounted under /contracts/:id to keep ceremony actions colocated with
 * the contract resource — Cedar resource path is `Contract::<id>` so the
 * same policies can pin both `contract::update` and `contract::send`.
 */
@Controller('contracts/:id')
@UseGuards(EsignEnabledGuard, JwtAuthGuard, RolesGuard, CedarGuard)
export class SigningController {
  constructor(private readonly ceremony: CeremonyService) {}

  @Post('send-for-signature')
  @HttpCode(202)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({
    action: 'contract::send',
    resource: (req) => `Contract::${(req as { params: { id: string } }).params.id}`,
  })
  async sendForSignature(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SendForSignatureSchema))
    body: Parameters<CeremonyService['sendForSignature']>[1],
  ) {
    return this.ceremony.sendForSignature(id, body);
  }
}
