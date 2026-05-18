import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ContractTemplatesModule } from '../contract-templates/contract-templates.module';
import { ContractsModule } from '../contracts/contracts.module';
import { CeremonyService } from './ceremony.service';
import { SigningService } from './signing.service';
import { SigningController } from './signing.controller';
import { PublicSigningController } from './public-signing.controller';
import { EsignEnabledGuard } from './esign-enabled.guard';

/**
 * Phase 2 F1 — wires the ceremony + signing services to their two
 * controllers (owner-side JWT and public token-based).
 *
 * Imports:
 *  - ContractsModule for PdfGeneratorService + AuditChainService.
 *  - ContractTemplatesModule for template resolution + variable allow-list.
 *  - ApprovalsModule for the F2 contract-approval gate.
 *  - AccessControlModule for the @RequireCedar on the owner-side controller.
 */
@Module({
  imports: [
    AuthModule,
    AuditModule,
    AccessControlModule,
    ApprovalsModule,
    ContractTemplatesModule,
    ContractsModule,
  ],
  controllers: [SigningController, PublicSigningController],
  providers: [CeremonyService, SigningService, EsignEnabledGuard],
  exports: [CeremonyService, SigningService],
})
export class ContractSignersModule {}
