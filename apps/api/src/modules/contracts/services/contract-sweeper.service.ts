import { Injectable, Logger } from '@nestjs/common';
import { WebhookEvent } from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { OutboxService } from '../../../infra/outbox/outbox.service';
import { AuditService } from '../../audit/audit.service';
import { AuditChainService } from './audit-chain.service';
import { loadEnv } from '../../../config/env';

/**
 * Phase 2 F1 — shared cron logic for the reminder + expire sweeps.
 *
 * Both sweeps need to iterate ContractSignature rows across many tenants.
 * `runAsWorker()` (planned in env DATABASE_URL_WORKER) isn't wired yet,
 * so we loop tenants serially and open one `runWithTenant` per tenant.
 * This is slower than a single cross-tenant scan but keeps RLS honest
 * — and the contract pipeline is low-volume (tens to low hundreds of
 * ceremonies per tenant per day at worst).
 */
@Injectable()
export class ContractSweeperService {
  private readonly logger = new Logger(ContractSweeperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly auditChain: AuditChainService,
  ) {}

  /**
   * Reminder cadence: T+3 / T+7 / T+12 days (configurable via
   * CONTRACT_REMINDER_OFFSETS_DAYS). For each PENDING/SENT/VIEWED signer
   * whose `sentAt` crosses an offset and where we haven't yet recorded a
   * REMINDER_SENT event for that offset, emit a reminder event +
   * notification log + audit-chain entry. We DON'T dispatch real email
   * here — same constraint as ceremony.notifyInitialSigners: needs a
   * default EmailAccount per user, deferred to a follow-up PR.
   *
   * Returns counts for the cron log line.
   */
  async sweepRemindersForAllTenants(now: Date = new Date()): Promise<{ tenants: number; reminders: number }> {
    const offsets = this.parseOffsetsDays();
    if (offsets.length === 0) return { tenants: 0, reminders: 0 };

    const tenants = await this.listTenantIds();
    let total = 0;
    for (const tenantId of tenants) {
      try {
        total += await this.sweepRemindersForTenant(tenantId, offsets, now);
      } catch (err) {
        this.logger.warn(
          `reminder sweep failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { tenants: tenants.length, reminders: total };
  }

  private async sweepRemindersForTenant(
    tenantId: string,
    offsetsDays: number[],
    now: Date,
  ): Promise<number> {
    // Find all live signers (sentAt set, still awaiting decision).
    const candidates = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractSignature.findMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'SENT', 'VIEWED'] },
          sentAt: { not: null },
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          tenantId: true,
          contractId: true,
          signerEmail: true,
          sentAt: true,
        },
      }),
    );
    if (candidates.length === 0) return 0;

    let reminders = 0;
    for (const c of candidates) {
      if (!c.sentAt) continue;
      const daysSince = Math.floor((now.getTime() - c.sentAt.getTime()) / 86_400_000);
      // Hit ANY offset reached today. We dedupe via the event log:
      // count of REMINDER_SENT events MUST equal the number of offsets
      // already crossed, otherwise we owe a reminder.
      const offsetsReached = offsetsDays.filter((d) => daysSince >= d);
      if (offsetsReached.length === 0) continue;

      const sentCount = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.contractSignatureEvent.count({
          where: { tenantId, signatureId: c.id, eventType: 'REMINDER_SENT' },
        }),
      );
      const owe = offsetsReached.length - sentCount;
      if (owe <= 0) continue;

      // Fire one reminder per missing offset, with audit + outbox-less logs.
      for (let i = 0; i < owe; i++) {
        const offsetIdx = sentCount + i;
        await this.prisma.runWithTenant(tenantId, async (tx) => {
          await tx.contractSignatureEvent.create({
            data: {
              tenantId,
              signatureId: c.id,
              eventType: 'REMINDER_SENT',
              metadata: { offsetDay: offsetsDays[offsetIdx] ?? null },
            },
          });
          await this.auditChain.append(tx, {
            contractId: c.contractId,
            signatureId: c.id,
            eventType: 'REMINDER_SENT',
            actorType: 'SYSTEM',
            actorEmail: c.signerEmail,
            payload: { offsetDay: offsetsDays[offsetIdx] ?? null, daysSinceSent: daysSince },
          });
        });
        void this.audit.log({
          action: 'contract.signature.reminded',
          subjectType: 'Contract',
          subjectId: c.contractId,
          tenantId,
          metadata: { signatureId: c.id, offsetDay: offsetsDays[offsetIdx] ?? null },
        });
        this.logger.log(
          `reminder signer=${c.id} contract=${c.contractId} email=${c.signerEmail} offset=${offsetsDays[offsetIdx]}d`,
        );
      }
      reminders += owe;
    }
    return reminders;
  }

  /**
   * Expire sweep: flip PENDING/SENT/VIEWED rows whose expires_at passed
   * to EXPIRED, then if EVERY signer for a contract is now terminal
   * without a single SIGNED, flip the parent Contract to DECLINED +
   * emit CONTRACT_EXPIRED outbox event.
   */
  async sweepExpiriesForAllTenants(now: Date = new Date()): Promise<{ tenants: number; expired: number; contracts: number }> {
    const tenants = await this.listTenantIds();
    let expired = 0;
    let contracts = 0;
    for (const tenantId of tenants) {
      try {
        const r = await this.sweepExpiriesForTenant(tenantId, now);
        expired += r.expired;
        contracts += r.contracts;
      } catch (err) {
        this.logger.warn(
          `expire sweep failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { tenants: tenants.length, expired, contracts };
  }

  private async sweepExpiriesForTenant(
    tenantId: string,
    now: Date,
  ): Promise<{ expired: number; contracts: number }> {
    // Find overdue signers.
    const overdue = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractSignature.findMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'SENT', 'VIEWED'] },
          expiresAt: { lt: now },
        },
        select: { id: true, contractId: true, signerEmail: true },
      }),
    );
    if (overdue.length === 0) return { expired: 0, contracts: 0 };

    let expired = 0;
    const affectedContracts = new Set<string>();
    for (const o of overdue) {
      await this.prisma.runWithTenant(tenantId, async (tx) => {
        await tx.contractSignature.update({
          where: { id: o.id },
          data: { status: 'EXPIRED' },
        });
        await tx.contractSignatureEvent.create({
          data: {
            tenantId,
            signatureId: o.id,
            eventType: 'EXPIRED',
            metadata: { expiredAtIso: now.toISOString() },
          },
        });
        await this.auditChain.append(tx, {
          contractId: o.contractId,
          signatureId: o.id,
          eventType: 'SIGNATURE_EXPIRED',
          actorType: 'SYSTEM',
          actorEmail: o.signerEmail,
          payload: { expiredAtIso: now.toISOString() },
        });
      });
      void this.audit.log({
        action: 'contract.signature.expired',
        subjectType: 'Contract',
        subjectId: o.contractId,
        tenantId,
        metadata: { signatureId: o.id },
      });
      affectedContracts.add(o.contractId);
      expired += 1;
    }

    // For each affected contract, decide whether to cascade to Contract.status=DECLINED.
    let contractsClosed = 0;
    for (const contractId of affectedContracts) {
      const closed = await this.maybeCascadeContractToExpired(tenantId, contractId, now);
      if (closed) contractsClosed += 1;
    }
    return { expired, contracts: contractsClosed };
  }

  /**
   * If a contract has zero PENDING/SENT/VIEWED signers AND zero SIGNED
   * signers (i.e. all expired/declined/voided), we flip the parent to
   * DECLINED + emit CONTRACT_EXPIRED. Returns true if the cascade fired.
   *
   * If at least one signer signed, we leave the contract alone — partial
   * signature cases are surfaced in the FE for owner review.
   */
  private async maybeCascadeContractToExpired(
    tenantId: string,
    contractId: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const counts = await tx.contractSignature.groupBy({
        by: ['status'],
        where: { tenantId, contractId },
        _count: { _all: true },
      });
      const byStatus = new Map<string, number>(
        counts.map((c) => [c.status, c._count._all]),
      );
      const live = (byStatus.get('PENDING') ?? 0) + (byStatus.get('SENT') ?? 0) + (byStatus.get('VIEWED') ?? 0);
      const signed = byStatus.get('SIGNED') ?? 0;
      if (live > 0 || signed > 0) return false;

      const contract = await tx.contract.findFirst({
        where: { id: contractId, tenantId, status: { in: ['PENDING_SIGNATURE'] } },
        select: { id: true },
      });
      if (!contract) return false;

      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'DECLINED' },
      });
      await this.auditChain.append(tx, {
        contractId,
        eventType: 'CONTRACT_VOIDED',
        actorType: 'SYSTEM',
        payload: { reason: 'all_signers_expired', expiredAtIso: now.toISOString() },
      });
      await this.outbox.publish(
        WebhookEvent.CONTRACT_EXPIRED,
        { contractId, expiredAtIso: now.toISOString() },
        { aggregateType: 'Contract', aggregateId: contractId, tx },
      );
      return true;
    });
  }

  /**
   * Tenant enumeration helper. We pull only active tenants — suspended
   * ones shouldn't generate notifications. Bypass tenant-extension via
   * the raw client because tenants is a global table.
   */
  private async listTenantIds(): Promise<string[]> {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return tenants.map((t) => t.id);
  }

  private parseOffsetsDays(): number[] {
    const env = loadEnv();
    return (env.CONTRACT_REMINDER_OFFSETS_DAYS ?? '3,7,12')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
  }
}
