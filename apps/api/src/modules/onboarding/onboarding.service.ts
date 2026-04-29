import { Injectable, Logger } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';
import { SAMPLE_COMPANIES, SAMPLE_DEAL_TITLES } from './onboarding.fixtures';

export interface OnboardingStatus {
  onboardingCompletedAt: Date | null;
  sampleDataLoadedAt: Date | null;
}

export interface SampleDataResult {
  companies: number;
  contacts: number;
  deals: number;
  alreadyLoaded: boolean;
}

/**
 * F1.9 — Onboarding state for new tenants.
 *
 * State is per-tenant (one wizard per organization, not per user). Owner of
 * a fresh tenant is redirected by the FE to /welcome until markComplete()
 * fires. Sample data is opt-in (step 4 of the wizard) and idempotent.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Read-only state check used by the FE to decide whether to show the wizard. */
  async getStatus(): Promise<OnboardingStatus> {
    const { tenantId } = requireTenantContext();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { onboardingCompletedAt: true, sampleDataLoadedAt: true },
    });
    return {
      onboardingCompletedAt: tenant?.onboardingCompletedAt ?? null,
      sampleDataLoadedAt: tenant?.sampleDataLoadedAt ?? null,
    };
  }

  /** Mark wizard as completed. Idempotent — calling twice is a no-op. */
  async markComplete(): Promise<Tenant> {
    const { tenantId } = requireTenantContext();
    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { onboardingCompletedAt: new Date() },
    });
    await this.audit.log({ action: 'tenant.onboarding.completed' });
    return updated;
  }

  /**
   * Load sample data — creates SAMPLE_COMPANIES.length companies (~30),
   * 1-3 contacts per company, and SAMPLE_DEAL_TITLES.length (~20) deals
   * spread across the default pipeline stages.
   *
   * Idempotent: returns alreadyLoaded:true if sampleDataLoadedAt is set.
   * All inserts run inside runWithTenant so RLS scopes them to this tenant.
   */
  async loadSampleData(): Promise<SampleDataResult> {
    const { tenantId, userId } = requireTenantContext();

    const current = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { sampleDataLoadedAt: true },
    });
    if (current?.sampleDataLoadedAt) {
      return { companies: 0, contacts: 0, deals: 0, alreadyLoaded: true };
    }

    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      // Find or create default pipeline (so deals have stages to land in)
      let pipeline = await tx.pipeline.findFirst({
        where: { tenantId, isDefault: true, deletedAt: null },
        include: { stages: { where: { deletedAt: null }, orderBy: { order: 'asc' } } },
      });
      if (!pipeline) {
        pipeline = await tx.pipeline.create({
          data: {
            tenantId,
            name: 'Vânzări',
            isDefault: true,
            order: 0,
            stages: {
              create: [
                { tenantId, name: 'Nou', type: 'OPEN', order: 0, probability: 10 },
                { tenantId, name: 'Calificat', type: 'OPEN', order: 10, probability: 30 },
                { tenantId, name: 'Negociere', type: 'OPEN', order: 20, probability: 60 },
                { tenantId, name: 'Câștigat', type: 'WON', order: 30, probability: 100 },
                { tenantId, name: 'Pierdut', type: 'LOST', order: 40, probability: 0 },
              ],
            },
          },
          include: { stages: { orderBy: { order: 'asc' } } },
        });
      }

      const openStages = pipeline.stages.filter((s) => s.type === 'OPEN');
      const wonStage = pipeline.stages.find((s) => s.type === 'WON');
      const lostStage = pipeline.stages.find((s) => s.type === 'LOST');

      // ── Companies + contacts ─────────────────────────────────────────────
      const companyIds: string[] = [];
      let contactCount = 0;

      for (const sc of SAMPLE_COMPANIES) {
        const company = await tx.company.create({
          data: {
            tenantId,
            name: sc.name,
            vatNumber: sc.vatNumber,
            industry: sc.industry,
            city: sc.city,
            country: 'RO',
            relationshipStatus: sc.relationshipStatus,
            leadSource: sc.leadSource,
            createdById: userId ?? null,
          },
        });
        companyIds.push(company.id);

        for (const contact of sc.contacts) {
          await tx.contact.create({
            data: {
              tenantId,
              companyId: company.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              jobTitle: contact.jobTitle,
              email: contact.email,
              phone: contact.phone ?? null,
              isDecider: contact.isDecider,
              createdById: userId ?? null,
            },
          });
          contactCount += 1;
        }
      }

      // ── Deals ────────────────────────────────────────────────────────────
      let dealCount = 0;
      for (const dealSpec of SAMPLE_DEAL_TITLES) {
        const companyId = companyIds[dealSpec.companyIndex % companyIds.length] ?? companyIds[0]!;
        let stageId: string;
        if (dealSpec.outcome === 'won' && wonStage) stageId = wonStage.id;
        else if (dealSpec.outcome === 'lost' && lostStage) stageId = lostStage.id;
        else stageId = openStages[dealSpec.companyIndex % openStages.length]?.id ?? openStages[0]!.id;

        await tx.deal.create({
          data: {
            tenantId,
            pipelineId: pipeline.id,
            stageId,
            companyId,
            ownerId: userId ?? null,
            title: dealSpec.title,
            value: dealSpec.value,
            currency: 'RON',
            status: dealSpec.outcome === 'won' ? 'WON' : dealSpec.outcome === 'lost' ? 'LOST' : 'OPEN',
            closedAt: dealSpec.outcome !== 'open' ? new Date() : null,
            createdById: userId ?? null,
          },
        });
        dealCount += 1;
      }

      return { companies: companyIds.length, contacts: contactCount, deals: dealCount };
    });

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { sampleDataLoadedAt: new Date() },
    });

    await this.audit.log({
      action: 'tenant.sample-data.loaded',
      metadata: result as unknown as Record<string, unknown>,
    });

    this.logger.log(`Sample data loaded for tenant ${tenantId}: ${JSON.stringify(result)}`);

    return { ...result, alreadyLoaded: false };
  }
}
