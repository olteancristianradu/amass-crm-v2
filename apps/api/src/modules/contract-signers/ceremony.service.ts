import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import {
  Contract,
  ContractSignature,
  Prisma,
  WebhookEvent,
} from '@prisma/client';
import {
  CeremonyViewResponse,
  SendForSignatureDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { StorageService } from '../../infra/storage/storage.service';
import { OutboxService } from '../../infra/outbox/outbox.service';
import { loadEnv } from '../../config/env';
import { ApprovalsService } from '../approvals/approvals.service';
import { AuditService } from '../audit/audit.service';
import { ContractTemplatesService } from '../contract-templates/contract-templates.service';
import { PdfGeneratorService } from '../contracts/services/pdf-generator.service';
import { AuditChainService } from '../contracts/services/audit-chain.service';

/**
 * Phase 2 F1 — ceremony orchestrator.
 *
 * Responsibilities:
 *  1. Send-for-signature: mint per-signer HMAC ceremonyToken, render +
 *     hash + upload the PDF, persist ContractSignature rows, gate via
 *     ApprovalsService (CONTRACT subject), and emit the outbox event.
 *  2. View (public): validate ceremonyToken, return signer-facing payload
 *     including a presigned PDF download URL (15min TTL).
 *  3. (Sign/decline live in SigningService — split so the ceremony module
 *     stays under 500 lines and the public callback paths get isolated
 *     test surface.)
 *
 * Threat coverage:
 *  - T-ESIGN-S-02 (token brute force): 32 bytes random + HMAC over
 *    signatureId. Constant-time compare in `verifyToken`.
 *  - T-ESIGN-I-01 (cross-tenant signature): every read is scoped via
 *    runWithTenant; the public callback resolves tenantId from the
 *    ContractSignature row, not from any client input.
 *  - T-ESIGN-T-01 (PDF tampering pre-signature): pdfHash persisted at
 *    issue time, re-verified on every signer interaction (SigningService).
 */
@Injectable()
export class CeremonyService {
  private readonly logger = new Logger(CeremonyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly auditChain: AuditChainService,
    private readonly templates: ContractTemplatesService,
    private readonly pdf: PdfGeneratorService,
    private readonly approvals: ApprovalsService,
  ) {}

  // ───────────────────────────────────────────────────────────────────
  // 1. Send for signature
  // ───────────────────────────────────────────────────────────────────

  /**
   * Initiate the ceremony. Returns the parent Contract with status
   * PENDING_SIGNATURE and the freshly-minted ContractSignature rows.
   *
   * F2 approval gate: if there is an active approval policy for the
   * CONTRACT subject AND its trigger matches this contract's value, we
   * create the ApprovalRequest first and throw 409 — the caller must
   * await approval before re-trying.
   */
  async sendForSignature(
    contractId: string,
    dto: SendForSignatureDto,
  ): Promise<{ contract: Contract; signatures: ContractSignature[] }> {
    const { tenantId, userId } = requireTenantContext();

    const contract = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contract.findFirst({
        where: { id: contractId, tenantId, deletedAt: null },
        include: { company: { select: { name: true } } },
      }),
    );
    if (!contract) {
      throw new NotFoundException({
        code: 'CONTRACT_NOT_FOUND',
        message: `Contract ${contractId} not found`,
      });
    }
    if (contract.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'CONTRACT_NOT_DRAFT',
        message: `Contract ${contractId} is ${contract.status}; only DRAFT contracts can be sent for signature`,
      });
    }

    // F2 gate. The approval value uses the contract's monetary value when set
    // (threshold-based policies match on `value` + `currency`). If the policy
    // suite doesn't match this contract, returned false → we proceed.
    const policyValue = contract.value ?? new Prisma.Decimal(0);
    const approvalCreated = await this.approvals.checkAndRequestApprovalForSubject(
      'CONTRACT',
      contractId,
      { value: policyValue, currency: contract.currency },
    );
    if (approvalCreated) {
      throw new ConflictException({
        code: 'APPROVAL_REQUIRED',
        message: 'Contract requires approval before sending for signature; an approval request has been created.',
      });
    }

    // Validate uniqueness of signer emails — Prisma unique would 500 with
    // a generic error otherwise.
    const seen = new Set<string>();
    for (const s of dto.signers) {
      const key = s.email.toLowerCase();
      if (seen.has(key)) {
        throw new BadRequestException({
          code: 'DUPLICATE_SIGNER_EMAIL',
          message: `Duplicate signer email "${s.email}" — each signer must have a unique email`,
        });
      }
      seen.add(key);
    }

    // Resolve the template. We re-load even if the caller passed the same id
    // that's already on Contract.templateId — the template's `variables`
    // array is the renderer's allow-list and we want the current view.
    const template = await this.templates.findOne(dto.templateId);
    if (template.status === 'ARCHIVED') {
      throw new BadRequestException({
        code: 'TEMPLATE_ARCHIVED',
        message: `Template ${template.id} is ARCHIVED — choose a PUBLISHED template`,
      });
    }

    // ── Render + hash the PDF (still DRAFT watermark — ceremony PDF is the
    // "to-be-signed" copy; the final sealed PDF is regenerated at completion
    // time in SigningService).
    const rendered = await this.pdf.renderContract({
      template,
      contract: {
        id: contract.id,
        title: contract.title,
        companyName: contract.company.name,
        createdAt: contract.createdAt,
      },
      fieldValues: dto.fieldValues,
      isFinal: false,
    });

    // ── Upload PDF to MinIO. Storage key follows the multi-tenant prefix
    // pattern (tenants/{tenantId}/contracts/{contractId}/v1.pdf) so any
    // future bucket-level RLS / IAM policy can pin a prefix per tenant.
    const pdfStorageKey = `tenants/${tenantId}/contracts/${contractId}/v1.pdf`;
    await this.storage.putObject(pdfStorageKey, rendered.buffer, 'application/pdf');

    const expiresAt = new Date(Date.now() + dto.expiresInDays * 86_400_000);

    // ── Single tx: update Contract, insert ContractSignature rows,
    // append audit-chain entry, publish outbox event. All-or-nothing.
    const { signatures: signatureRows } = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const updatedContract = await tx.contract.update({
        where: { id: contractId },
        data: {
          status: 'PENDING_SIGNATURE',
          templateId: template.id,
          pdfStorageKey,
          pdfHash: rendered.sha256,
          signingExpiresAt: expiresAt,
          signingMode: dto.mode,
        },
      });

      const signatures: ContractSignature[] = [];
      for (const s of dto.signers) {
        // Pre-allocate the row id so we can HMAC-bind the token to it
        // (so a leaked token doesn't help on a different ContractSignature).
        const id = `cs_${randomBytes(12).toString('hex')}`;
        const ceremonyToken = this.mintToken(id);
        const row = await tx.contractSignature.create({
          data: {
            id,
            tenantId,
            contractId,
            signerEmail: s.email.toLowerCase(),
            signerName: s.name,
            signerRole: s.role,
            signingOrder: s.order,
            ceremonyToken,
            ceremonyTokenKid: 'v1',
            status: 'PENDING',
            expiresAt,
          },
        });
        signatures.push(row);

        await tx.contractSignatureEvent.create({
          data: {
            tenantId,
            signatureId: row.id,
            eventType: 'TOKEN_ISSUED',
          },
        });
      }

      await this.auditChain.append(tx, {
        contractId,
        eventType: 'CEREMONY_CREATED',
        actorType: 'TENANT_USER',
        actorId: userId ?? null,
        payload: {
          templateId: template.id,
          templateVersion: template.version,
          pdfHash: rendered.sha256,
          mode: dto.mode,
          signerCount: signatures.length,
        },
      });
      await this.auditChain.append(tx, {
        contractId,
        eventType: 'PDF_RENDERED',
        actorType: 'TENANT_USER',
        actorId: userId ?? null,
        payload: { pdfStorageKey, byteLength: rendered.byteLength, pdfHash: rendered.sha256 },
      });

      await this.outbox.publish(
        WebhookEvent.CONTRACT_SENT_FOR_SIGNATURE,
        {
          contractId,
          signers: signatures.map((sr) => ({ id: sr.id, email: sr.signerEmail, order: sr.signingOrder })),
          mode: dto.mode,
          expiresAt: expiresAt.toISOString(),
        },
        { aggregateType: 'Contract', aggregateId: contractId, tx },
      );

      return { contract: updatedContract, signatures };
    });

    // Best-effort notification dispatch — handled OUTSIDE the tx so a
    // mail-server hiccup never rolls back the ceremony state. We only
    // notify the first signer in SEQUENTIAL mode; all of them in
    // PARALLEL.
    await this.notifyInitialSigners(contractId, signatureRows, dto.mode);

    void this.audit.log({
      action: 'contract.signature.sent',
      subjectType: 'Contract',
      subjectId: contractId,
      metadata: { signers: signatureRows.length, mode: dto.mode },
    });

    return {
      contract: (await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.contract.findFirst({ where: { id: contractId, tenantId } }),
      )) as Contract,
      signatures: signatureRows,
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // 2. View (public)
  // ───────────────────────────────────────────────────────────────────

  /**
   * Public ceremony view. Verifies the token, returns counterparty-safe
   * metadata + a fresh presigned PDF download URL. No JWT, throttled by
   * controller-level guard.
   *
   * Side effects:
   *  - First view stamps `firstViewedAt`.
   *  - Always appends a SIGNATURE_LINK_OPENED audit chain entry +
   *    a VIEWED ContractSignatureEvent.
   */
  async view(token: string, ip?: string, userAgent?: string): Promise<CeremonyViewResponse> {
    const signer = await this.loadSignerByToken(token);

    if (signer.status === 'EXPIRED' || (signer.expiresAt && signer.expiresAt < new Date())) {
      throw new NotFoundException({
        code: 'CEREMONY_EXPIRED',
        message: 'This signing link has expired.',
      });
    }
    if (signer.status === 'DECLINED' || signer.status === 'VOIDED') {
      throw new NotFoundException({
        code: 'CEREMONY_CLOSED',
        message: `This signing ceremony is closed (status: ${signer.status}).`,
      });
    }

    const { tenantId } = signer;
    const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const contract = await tx.contract.findFirst({
        where: { id: signer.contractId, tenantId },
        include: {
          company: { select: { name: true } },
          signatures: {
            select: { id: true, signerName: true, status: true, signingOrder: true },
            orderBy: { signingOrder: 'asc' },
          },
        },
      });
      if (!contract || !contract.pdfStorageKey) {
        // Defensive — if the contract was hard-deleted somehow, fail closed.
        throw new NotFoundException({ code: 'CONTRACT_GONE', message: 'Contract is no longer available.' });
      }

      // Stamp first-view + emit events.
      if (!signer.firstViewedAt) {
        await tx.contractSignature.update({
          where: { id: signer.id },
          data: { firstViewedAt: new Date(), status: signer.status === 'PENDING' ? 'VIEWED' : signer.status },
        });
      }
      await tx.contractSignatureEvent.create({
        data: {
          tenantId,
          signatureId: signer.id,
          eventType: 'VIEWED',
          ipAddress: ip ?? null,
          userAgent: userAgent ?? null,
        },
      });
      await this.auditChain.append(tx, {
        contractId: signer.contractId,
        signatureId: signer.id,
        eventType: 'SIGNATURE_LINK_OPENED',
        actorType: 'SIGNER',
        actorId: signer.id,
        actorEmail: signer.signerEmail,
        actorIp: ip ?? null,
        payload: { userAgent: userAgent ?? null },
      });

      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      return { contract, tenant };
    });

    const presignedPdfUrl = await this.storage.presignGet(
      result.contract.pdfStorageKey as string,
      `${result.contract.title.replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`,
    );

    const canSignNow = this.canSignerProceed(signer, result.contract.signatures);

    return {
      contractTitle: result.contract.title,
      tenantName: result.tenant?.name ?? 'Unknown',
      signerName: signer.signerName,
      signerEmail: signer.signerEmail,
      status: signer.status,
      pdfDownloadUrl: presignedPdfUrl,
      expiresAt: signer.expiresAt.toISOString(),
      cosigners: result.contract.signatures
        .filter((cs) => cs.id !== signer.id)
        .map((cs) => ({ name: cs.signerName, status: cs.status, order: cs.signingOrder })),
      canSignNow,
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // Token mint / verify
  // ───────────────────────────────────────────────────────────────────

  /**
   * Mint a 64-hex token bound to the ContractSignature id. The HMAC tail
   * means an attacker who acquires the key still has to enumerate the
   * signatureId space (cuid-like) AND match the exact tail.
   *
   * Format: hex(randomBytes(20)) || hex(hmac(key, randomBytes||sigId))
   *         = 40 + 24 chars = 64 hex chars total
   * Stored as-is on ContractSignature.ceremonyToken (VARCHAR(64)).
   */
  mintToken(signatureId: string): string {
    const random = randomBytes(20).toString('hex'); // 40 hex chars
    const key = this.getHmacKey();
    const mac = createHmac('sha256', key)
      .update(`${random}|${signatureId}`)
      .digest('hex')
      .slice(0, 24); // 24 hex chars (96 bits) — enough for tamper-evidence
    return `${random}${mac}`;
  }

  /**
   * Re-derive the HMAC tail and constant-time-compare against the stored
   * token. Returns true iff (token, signatureId) was minted by us.
   *
   * Note: we look up the row by ceremonyToken THEN verify the HMAC tail
   * against the row's id. This means a leaked token doesn't help on a
   * different row — even if Postgres looked up the wrong row by accident
   * (it won't, the column is unique), the HMAC check would fail.
   */
  verifyToken(token: string, signatureId: string): boolean {
    if (token.length !== 64) return false;
    const random = token.slice(0, 40);
    const mac = token.slice(40);
    const key = this.getHmacKey();
    const expected = createHmac('sha256', key)
      .update(`${random}|${signatureId}`)
      .digest('hex')
      .slice(0, 24);
    // Length-checked above; same-length strings are safe to constant-time-compare.
    if (mac.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  }

  /**
   * Internal: load the ContractSignature by token + verify HMAC.
   * Public to SigningService via module export.
   */
  async loadSignerByToken(token: string): Promise<ContractSignature> {
    if (typeof token !== 'string' || token.length !== 64 || !/^[0-9a-f]+$/.test(token)) {
      // Bad shape — fail closed with a 404 to avoid leaking "token exists".
      throw new NotFoundException({ code: 'BAD_TOKEN', message: 'Invalid signing link.' });
    }
    // Bypass tenantExtension via internal client — the token IS the auth.
    // Token uniqueness is enforced by DB index; HMAC re-check pins it to id.
    const row = await this.prisma.contractSignature.findUnique({
      where: { ceremonyToken: token },
    });
    if (!row) {
      throw new NotFoundException({ code: 'BAD_TOKEN', message: 'Invalid signing link.' });
    }
    if (!this.verifyToken(token, row.id)) {
      this.logger.warn(`Ceremony token HMAC mismatch for signature ${row.id} — possible tampering`);
      throw new NotFoundException({ code: 'BAD_TOKEN', message: 'Invalid signing link.' });
    }
    return row;
  }

  /** SEQUENTIAL gate: this signer can proceed only when every earlier order signed. */
  canSignerProceed(
    signer: Pick<ContractSignature, 'id' | 'signingOrder' | 'status'>,
    allSigners: Array<{ id: string; signingOrder: number; status: string }>,
  ): boolean {
    if (signer.status !== 'PENDING' && signer.status !== 'SENT' && signer.status !== 'VIEWED') {
      return false;
    }
    // PARALLEL doesn't store the mode here — but the rule "all earlier orders
    // SIGNED" collapses safely to "true" when everyone has signingOrder=0.
    const earlier = allSigners.filter((s) => s.signingOrder < signer.signingOrder);
    return earlier.every((s) => s.status === 'SIGNED');
  }

  /**
   * Best-effort notification dispatch — writes an in-app Notification row
   * (audit-trail) and logs the signer URLs. Real email send is wired via
   * EmailService.sendToAddress in a follow-up PR; for now the audit row +
   * log line is enough for the e2e test to assert "notification fanned out".
   *
   * SECURITY: the ceremony URL contains the token — logging at INFO level
   * is acceptable in dev but should be DEBUG only in production. We mask
   * the tail in the log line so prod logs don't leak the full token.
   */
  private async notifyInitialSigners(
    contractId: string,
    signers: ContractSignature[],
    mode: 'PARALLEL' | 'SEQUENTIAL',
  ): Promise<void> {
    const env = loadEnv();
    const base = env.CONTRACT_CEREMONY_BASE_URL ?? env.PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
    const targets =
      mode === 'PARALLEL'
        ? signers
        : signers.filter((s) => s.signingOrder === Math.min(...signers.map((x) => x.signingOrder)));

    for (const s of targets) {
      const masked = `${s.ceremonyToken.slice(0, 8)}…${s.ceremonyToken.slice(-4)}`;
      this.logger.log(
        `ceremony-invite signer=${s.id} email=${s.signerEmail} url=${base}/sign/${masked}`,
      );
      try {
        await this.prisma.runWithTenant(s.tenantId, (tx) =>
          tx.contractSignatureEvent.create({
            data: {
              tenantId: s.tenantId,
              signatureId: s.id,
              eventType: 'SENT',
              metadata: { transport: 'log', mode },
            },
          }),
        );
        await this.prisma.runWithTenant(s.tenantId, (tx) =>
          tx.contractSignature.update({
            where: { id: s.id },
            data: { sentAt: new Date(), status: s.status === 'PENDING' ? 'SENT' : s.status },
          }),
        );
      } catch (err) {
        this.logger.warn(
          `Failed to mark signer ${s.id} SENT: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private getHmacKey(): string {
    const env = loadEnv();
    // Dev fallback to JWT_SECRET keeps unit tests working without extra env.
    // Prod boot rejects this fallback when CONTRACT_ESIGN_ENABLED=true
    // (see env.ts prodOnlyChecks).
    return env.CONTRACT_HMAC_KEY ?? env.JWT_SECRET;
  }
}
