import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, WebhookEvent } from '@prisma/client';
import {
  DeclineSignatureDto,
  SubmitSignatureDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { AuditChainService } from '../contracts/services/audit-chain.service';
import {
  PdfGeneratorService,
  SignatureCertificateSigner,
} from '../contracts/services/pdf-generator.service';
import { CeremonyService } from './ceremony.service';

/**
 * Phase 2 F1 — public signing callback service.
 *
 * Two terminal transitions per signer:
 *  - sign(token, dto)    — PENDING/SENT/VIEWED → SIGNED
 *  - decline(token, dto) — PENDING/SENT/VIEWED → DECLINED
 *
 * Concurrency: each transition opens a Postgres transaction and takes a
 * row-level lock on the ContractSignature via SELECT ... FOR UPDATE
 * ($queryRaw — Prisma doesn't surface FOR UPDATE in the typed client).
 * Two concurrent /sign POSTs on the same token therefore serialise; the
 * second sees status=SIGNED and 409-aborts.
 *
 * PNG validation (T-ESIGN-T-02): see `assertPng()` below — strict magic
 * bytes + IHDR sanity check, before we trust the bytes to write to MinIO.
 */
@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);

  // 8-byte PNG signature per RFC 2083. Anything else gets a 400.
  private static readonly PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  private static readonly MAX_SIGNATURE_BYTES = 1 * 1024 * 1024; // 1MB

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly auditChain: AuditChainService,
    private readonly ceremony: CeremonyService,
    private readonly pdfGenerator: PdfGeneratorService,
  ) {}

  // ───────────────────────────────────────────────────────────────────
  // sign
  // ───────────────────────────────────────────────────────────────────

  async sign(
    token: string,
    dto: SubmitSignatureDto,
    ctx: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<{ status: string; signedAt: Date; contractCompleted: boolean }> {
    const signer = await this.ceremony.loadSignerByToken(token);
    const { tenantId, contractId, id: signatureId } = signer;

    // Decode + validate PNG BEFORE we touch the DB or MinIO. Cheap check
    // means a malicious payload never costs us a roundtrip.
    const png = this.assertPng(dto.signatureImageBase64);
    const signatureHash = createHash('sha256').update(png).digest('hex');

    // Storage key — same multi-tenant prefix discipline as the PDF.
    const signatureStorageKey = `tenants/${tenantId}/contracts/${contractId}/signatures/${signatureId}.png`;

    // Idempotency: if the row is already SIGNED, return the prior outcome
    // (the FE may retry on network blip). DECLINED/EXPIRED → conflict.
    if (signer.status === 'SIGNED') {
      return {
        status: 'SIGNED',
        signedAt: signer.signedAt ?? new Date(),
        contractCompleted: await this.isContractComplete(tenantId, contractId),
      };
    }
    if (signer.status === 'DECLINED' || signer.status === 'EXPIRED' || signer.status === 'VOIDED') {
      throw new ConflictException({
        code: 'CEREMONY_TERMINAL',
        message: `Cannot sign — current status: ${signer.status}`,
      });
    }

    // ── Pre-checks before storage write. Reload all signers + the contract
    // pdfHash; verify pdfHash equals the persisted one (T-ESIGN-T-01).
    const contract = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contract.findFirst({
        where: { id: contractId, tenantId },
        select: { id: true, pdfStorageKey: true, pdfHash: true, signingMode: true },
      }),
    );
    if (!contract || !contract.pdfStorageKey || !contract.pdfHash) {
      throw new NotFoundException({ code: 'CONTRACT_GONE', message: 'Contract is no longer available.' });
    }

    // We deliberately DO re-read the bytes & re-hash on demand to detect
    // out-of-band tampering with the MinIO object. This is the T-ESIGN-T-01
    // guard — the persisted hash MUST match what's on disk before we let
    // the signer commit.
    const pdfBytes = await this.storage.getObjectAsBuffer(contract.pdfStorageKey);
    const recomputedPdfHash = createHash('sha256').update(pdfBytes).digest('hex');
    if (recomputedPdfHash !== contract.pdfHash) {
      this.logger.error(
        `PDF tamper detected for contract ${contractId}: stored=${contract.pdfHash} on-disk=${recomputedPdfHash}`,
      );
      throw new ConflictException({
        code: 'PDF_TAMPERED',
        message: 'Contract PDF has been modified since the ceremony started. Re-issue required.',
      });
    }

    // SEQUENTIAL gate
    const allSigners = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractSignature.findMany({
        where: { tenantId, contractId },
        orderBy: { signingOrder: 'asc' },
        select: { id: true, signingOrder: true, status: true },
      }),
    );
    if (contract.signingMode === 'SEQUENTIAL') {
      const earlier = allSigners.filter((s) => s.signingOrder < signer.signingOrder);
      if (!earlier.every((s) => s.status === 'SIGNED')) {
        throw new ConflictException({
          code: 'OUT_OF_ORDER',
          message: 'Earlier signers have not yet signed. Please wait.',
        });
      }
    }

    // ── Upload PNG to MinIO (outside tx — MinIO is not transactional).
    await this.storage.putObject(signatureStorageKey, png, 'image/png');

    // ── Tx: SELECT FOR UPDATE, write the row, audit, outbox (if last).
    const now = new Date();
    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      // T-ESIGN-S-01 replay defense — lock the row and re-read status.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "contract_signatures" WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        signatureId,
        tenantId,
      );
      const fresh = await tx.contractSignature.findFirst({
        where: { id: signatureId, tenantId },
        select: { status: true },
      });
      if (!fresh) throw new NotFoundException({ code: 'SIGNER_GONE', message: 'Signer no longer exists.' });
      if (fresh.status === 'SIGNED') {
        // Lost the race — return the prior signed timestamp.
        return { contractCompleted: await this.isContractComplete(tenantId, contractId), alreadySigned: true };
      }
      if (!['PENDING', 'SENT', 'VIEWED'].includes(fresh.status)) {
        throw new ConflictException({
          code: 'CEREMONY_TERMINAL',
          message: `Cannot sign — current status: ${fresh.status}`,
        });
      }

      await tx.contractSignature.update({
        where: { id: signatureId },
        data: {
          status: 'SIGNED',
          signedAt: now,
          signatureStorageKey,
          signatureHash,
          signatureProof: dto.signatureProof
            ? (dto.signatureProof as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      await tx.contractSignatureEvent.create({
        data: {
          tenantId,
          signatureId,
          eventType: 'SIGNED',
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      await this.auditChain.append(tx, {
        contractId,
        signatureId,
        eventType: 'SIGNATURE_SUBMITTED',
        actorType: 'SIGNER',
        actorId: signatureId,
        actorEmail: signer.signerEmail,
        actorIp: ctx.ipAddress ?? null,
        payload: {
          pdfHash: contract.pdfHash,
          signatureHash,
          agreedAtClient: dto.agreedAt.toISOString(),
          agreedAtServer: now.toISOString(),
        },
      });

      // Check whether THIS signature completes the contract.
      const remaining = await tx.contractSignature.count({
        where: { tenantId, contractId, status: { notIn: ['SIGNED', 'DECLINED', 'EXPIRED', 'VOIDED'] } },
      });
      // Subtract 1 because we just updated the row inside this tx but the
      // count above is taken AFTER the update (Prisma sees our write).

      const declinedOrExpired = await tx.contractSignature.count({
        where: { tenantId, contractId, status: { in: ['DECLINED', 'EXPIRED', 'VOIDED'] } },
      });
      if (declinedOrExpired > 0) {
        // Edge case — a sequential ceremony where the previous signer declined
        // but a later signer's link was opened before the cascade ran. Refuse
        // to complete.
        throw new ConflictException({
          code: 'CO_SIGNER_DECLINED',
          message: 'Cannot complete contract — at least one co-signer declined or the ceremony expired.',
        });
      }

      const contractCompleted = remaining === 0;
      if (contractCompleted) {
        // Flip the parent Contract to ACTIVE + write completion audit.
        await tx.contract.update({
          where: { id: contractId },
          data: { status: 'ACTIVE', signedAt: now },
        });
        await this.auditChain.append(tx, {
          contractId,
          eventType: 'CONTRACT_COMPLETED',
          actorType: 'SYSTEM',
          payload: { pdfHash: contract.pdfHash, completedAt: now.toISOString() },
        });
        await this.outbox.publish(
          WebhookEvent.CONTRACT_SIGNED,
          { contractId, signedAt: now.toISOString(), pdfHash: contract.pdfHash },
          { aggregateType: 'Contract', aggregateId: contractId, tx },
        );
      }

      return { contractCompleted, alreadySigned: false };
    });

    void this.audit.log({
      action: 'contract.signature.signed',
      subjectType: 'Contract',
      subjectId: contractId,
      tenantId,
      metadata: { signatureId, signatureHash, contractCompleted: result.contractCompleted },
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    });

    // CRIT-1 — on completion, produce the standalone signature-certificate
    // PDF under the `signed/` prefix. Best-effort post-commit: a failure
    // logs but does not roll back the completed signature.
    if (result.contractCompleted) {
      await this.generateSignatureCertificate(tenantId, contractId, contract.pdfHash, now).catch(
        (err) =>
          this.logger.error(
            `signature certificate generation failed for contract ${contractId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
      );
    }

    // If sequential and contract not complete, notify the next signer (fire-and-forget).
    if (!result.contractCompleted && contract.signingMode === 'SEQUENTIAL') {
      await this.notifyNextSequentialSigner(tenantId, contractId).catch((err) =>
        this.logger.warn(
          `failed to notify next signer for contract ${contractId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    return {
      status: 'SIGNED',
      signedAt: now,
      contractCompleted: result.contractCompleted,
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // decline
  // ───────────────────────────────────────────────────────────────────

  async decline(
    token: string,
    dto: DeclineSignatureDto,
    ctx: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<{ status: 'DECLINED' }> {
    const signer = await this.ceremony.loadSignerByToken(token);
    const { tenantId, contractId, id: signatureId } = signer;

    if (signer.status === 'DECLINED') {
      return { status: 'DECLINED' }; // idempotent
    }
    if (['SIGNED', 'EXPIRED', 'VOIDED'].includes(signer.status)) {
      throw new ConflictException({
        code: 'CEREMONY_TERMINAL',
        message: `Cannot decline — current status: ${signer.status}`,
      });
    }

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "contract_signatures" WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        signatureId,
        tenantId,
      );

      await tx.contractSignature.update({
        where: { id: signatureId },
        data: {
          status: 'DECLINED',
          declinedAt: new Date(),
          declineReason: dto.reason,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });

      await tx.contractSignatureEvent.create({
        data: {
          tenantId,
          signatureId,
          eventType: 'DECLINED',
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
          metadata: { reason: dto.reason.slice(0, 256) },
        },
      });

      await this.auditChain.append(tx, {
        contractId,
        signatureId,
        eventType: 'SIGNATURE_DECLINED',
        actorType: 'SIGNER',
        actorId: signatureId,
        actorEmail: signer.signerEmail,
        actorIp: ctx.ipAddress ?? null,
        payload: { reason: dto.reason.slice(0, 256) },
      });

      // Cascade: a single decline kills the contract. Other PENDING/SENT/VIEWED
      // signers transition to VOIDED so their tokens stop working.
      await tx.contractSignature.updateMany({
        where: {
          tenantId,
          contractId,
          status: { in: ['PENDING', 'SENT', 'VIEWED'] },
          id: { not: signatureId },
        },
        data: { status: 'VOIDED' },
      });

      await tx.contract.update({
        where: { id: contractId },
        data: { status: 'DECLINED' },
      });

      await this.auditChain.append(tx, {
        contractId,
        eventType: 'CONTRACT_VOIDED',
        actorType: 'SYSTEM',
        payload: { reason: 'signer_declined', triggerSignatureId: signatureId },
      });

      await this.outbox.publish(
        WebhookEvent.CONTRACT_DECLINED,
        { contractId, declinedBy: signer.signerEmail, reason: dto.reason.slice(0, 256) },
        { aggregateType: 'Contract', aggregateId: contractId, tx },
      );
    });

    void this.audit.log({
      action: 'contract.signature.declined',
      subjectType: 'Contract',
      subjectId: contractId,
      tenantId,
      metadata: { signatureId, reason: dto.reason.slice(0, 256) },
      ipAddress: ctx.ipAddress ?? undefined,
      userAgent: ctx.userAgent ?? undefined,
    });

    return { status: 'DECLINED' };
  }

  // ───────────────────────────────────────────────────────────────────
  // helpers
  // ───────────────────────────────────────────────────────────────────

  /**
   * T-ESIGN-T-02 — strict PNG validation.
   *
   * 1. Decode base64 from the data-URL prefix.
   * 2. Enforce size cap (post-decode bytes).
   * 3. Verify the 8-byte PNG signature (RFC 2083 §3.1).
   * 4. Verify the first chunk is IHDR (sanity: random base64 that starts
   *    with the magic bytes still won't pass).
   *
   * Throws BadRequestException on any failure. Returns the raw PNG bytes
   * for the caller to hash + upload.
   */
  assertPng(dataUrl: string): Buffer {
    // The Zod schema already enforced the data:image/png;base64, prefix.
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) {
      throw new BadRequestException({ code: 'BAD_PNG', message: 'signatureImageBase64 must be a data URL.' });
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
    } catch {
      throw new BadRequestException({ code: 'BAD_PNG', message: 'signatureImageBase64 base64 decode failed.' });
    }
    if (buf.length === 0 || buf.length > SigningService.MAX_SIGNATURE_BYTES) {
      throw new BadRequestException({
        code: 'BAD_PNG',
        message: `signature PNG must be 1 byte to ${SigningService.MAX_SIGNATURE_BYTES} bytes (got ${buf.length})`,
      });
    }
    if (!buf.subarray(0, 8).equals(SigningService.PNG_MAGIC)) {
      throw new BadRequestException({
        code: 'BAD_PNG',
        message: 'signature image is not a valid PNG (magic byte mismatch).',
      });
    }
    // PNG layout: 8-byte signature, then a chunk: [4 bytes length][4 bytes type=IHDR][...]
    // IHDR is mandatory and always FIRST per RFC 2083 §3.2.
    if (buf.length < 16 || buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
      throw new BadRequestException({
        code: 'BAD_PNG',
        message: 'signature image is not a valid PNG (missing IHDR chunk).',
      });
    }
    return buf;
  }

  /**
   * CRIT-1 — post-completion evidentiary artifact. Builds a standalone
   * Signature Certificate PDF (signer roster + embedded signature images +
   * the executed-document hash) and stores it under the distinct `signed/`
   * prefix. The executed contract PDF at Contract.pdfStorageKey is left
   * untouched — the certificate is additive, never a silent re-render of
   * signed content. Runs post-commit because MinIO + PDF rendering are slow
   * and non-transactional.
   */
  private async generateSignatureCertificate(
    tenantId: string,
    contractId: string,
    signedPdfHash: string,
    completedAt: Date,
  ): Promise<void> {
    const contract = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contract.findFirst({
        where: { id: contractId, tenantId },
        select: { id: true, title: true, company: { select: { name: true } } },
      }),
    );
    if (!contract) return;

    const signers = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractSignature.findMany({
        where: { tenantId, contractId, status: 'SIGNED' },
        orderBy: { signingOrder: 'asc' },
        select: {
          signerName: true,
          signerEmail: true,
          signerRole: true,
          signedAt: true,
          ipAddress: true,
          signatureStorageKey: true,
        },
      }),
    );

    const certSigners: SignatureCertificateSigner[] = [];
    for (const s of signers) {
      if (!s.signatureStorageKey || !s.signedAt) continue;
      const png = await this.storage.getObjectAsBuffer(s.signatureStorageKey);
      certSigners.push({
        name: s.signerName,
        email: s.signerEmail,
        role: String(s.signerRole),
        signedAt: s.signedAt,
        ipAddress: s.ipAddress,
        signatureImagePng: png,
      });
    }

    const cert = await this.pdfGenerator.renderSignatureCertificate({
      contract: { id: contract.id, title: contract.title, companyName: contract.company.name },
      signedPdfHash,
      signers: certSigners,
      completedAt,
    });

    const certificateStorageKey = `tenants/${tenantId}/contracts/${contractId}/signed/certificate.pdf`;
    await this.storage.putObject(certificateStorageKey, cert.buffer, 'application/pdf');

    await this.prisma.runWithTenant(tenantId, (tx) =>
      this.auditChain.append(tx, {
        contractId,
        eventType: 'PDF_RENDERED',
        actorType: 'SYSTEM',
        payload: {
          artifact: 'signature_certificate',
          certificateStorageKey,
          certificateHash: cert.sha256,
          signedPdfHash,
        },
      }),
    );

    this.logger.log(
      `signature certificate stored for contract ${contractId} key=${certificateStorageKey}`,
    );
  }

  private async isContractComplete(tenantId: string, contractId: string): Promise<boolean> {
    return this.prisma
      .runWithTenant(tenantId, (tx) =>
        tx.contractSignature.count({
          where: { tenantId, contractId, status: { not: 'SIGNED' } },
        }),
      )
      .then((c) => c === 0);
  }

  private async notifyNextSequentialSigner(tenantId: string, contractId: string): Promise<void> {
    const next = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractSignature.findFirst({
        where: { tenantId, contractId, status: { in: ['PENDING', 'SENT', 'VIEWED'] } },
        orderBy: { signingOrder: 'asc' },
      }),
    );
    if (!next) return;
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractSignatureEvent.create({
        data: { tenantId, signatureId: next.id, eventType: 'SENT', metadata: { trigger: 'sequential-next' } },
      }),
    );
    this.logger.log(`sequential-next notify signer=${next.id} email=${next.signerEmail}`);
  }
}
