import { Injectable } from '@nestjs/common';
import {
  ConsentPurpose,
  ConsentRecord,
  ConsentStatus,
  LawfulBasis,
  Prisma,
  SubjectType,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { AuditService } from '../audit/audit.service';

export interface GrantConsentInput {
  subjectType: SubjectType;
  subjectId: string;
  purpose: ConsentPurpose;
  lawfulBasis: LawfulBasis;
  source?: string;
  ipAddress?: string;
  userAgent?: string;
  evidence?: Prisma.InputJsonValue;
}

export interface RevokeConsentInput {
  subjectType: SubjectType;
  subjectId: string;
  purpose: ConsentPurpose;
  source?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * GDPR consent tracking — append-only model.
 *
 * GRANT and REVOKE both INSERT new rows; the "current" state for a
 * (subject, purpose) is the latest row by createdAt. Schema enforces
 * append-only at DB layer too: app_user has SELECT + INSERT only,
 * UPDATE/DELETE/TRUNCATE are revoked. See migration
 * 20260429061500_consent_records_append_only.
 *
 * Why append-only: GDPR Art. 7(1) requires the controller to be able to
 * DEMONSTRATE consent. Mutating an existing row destroys evidence; the
 * regulator (ANSPDCP) wants to see the full history of what the data
 * subject agreed to and when.
 */
@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Grant a new consent (or re-grant if previously revoked). */
  async grant(input: GrantConsentInput): Promise<ConsentRecord> {
    const { tenantId } = requireTenantContext();
    const now = new Date();

    const row = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.consentRecord.create({
        data: {
          tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          purpose: input.purpose,
          lawfulBasis: input.lawfulBasis,
          status: ConsentStatus.GRANTED,
          grantedAt: now,
          source: input.source ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
        },
      }),
    );

    await this.audit.log({
      action: 'consent.grant',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: {
        consentId: row.id,
        purpose: input.purpose,
        lawfulBasis: input.lawfulBasis,
        source: input.source,
      },
    });

    return row;
  }

  /** Revoke a consent — INSERTs new row with status=REVOKED, never UPDATEs. */
  async revoke(input: RevokeConsentInput): Promise<ConsentRecord> {
    const { tenantId } = requireTenantContext();
    const now = new Date();

    // Find the most recent grant to inherit lawfulBasis (for audit continuity).
    // If none exists, default to CONSENT (revocation only makes sense if there
    // was an explicit consent in the first place).
    const lastGrant = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.consentRecord.findFirst({
        where: {
          tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          purpose: input.purpose,
          status: ConsentStatus.GRANTED,
        },
        orderBy: { createdAt: 'desc' },
      }),
    );

    const row = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.consentRecord.create({
        data: {
          tenantId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          purpose: input.purpose,
          lawfulBasis: lastGrant?.lawfulBasis ?? LawfulBasis.CONSENT,
          status: ConsentStatus.REVOKED,
          revokedAt: now,
          source: input.source ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      }),
    );

    await this.audit.log({
      action: 'consent.revoke',
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: {
        consentId: row.id,
        purpose: input.purpose,
        source: input.source,
        previousGrantId: lastGrant?.id,
      },
    });

    return row;
  }

  /** Full audit trail of consent events for a subject (newest first). */
  async listForSubject(subjectType: SubjectType, subjectId: string): Promise<ConsentRecord[]> {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.consentRecord.findMany({
        where: { tenantId, subjectType, subjectId },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Current state of consent per purpose for a subject. Returns one row per
   * purpose (the most recent), so caller can quickly see all granted/revoked
   * states at-a-glance. Empty array if subject has no consent records.
   */
  async currentByPurpose(
    subjectType: SubjectType,
    subjectId: string,
  ): Promise<ConsentRecord[]> {
    const all = await this.listForSubject(subjectType, subjectId);
    const seen = new Set<ConsentPurpose>();
    const latest: ConsentRecord[] = [];
    for (const row of all) {
      if (seen.has(row.purpose)) continue;
      seen.add(row.purpose);
      latest.push(row);
    }
    return latest;
  }

  /**
   * Boolean check: does this subject currently have an unrevoked, unexpired
   * consent for this specific purpose? Use BEFORE sending email/SMS or doing
   * any consent-gated operation. False if never granted, revoked, or expired.
   */
  async hasConsent(
    subjectType: SubjectType,
    subjectId: string,
    purpose: ConsentPurpose,
  ): Promise<boolean> {
    const { tenantId } = requireTenantContext();
    const latest = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.consentRecord.findFirst({
        where: { tenantId, subjectType, subjectId, purpose },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return latest?.status === ConsentStatus.GRANTED;
  }
}
