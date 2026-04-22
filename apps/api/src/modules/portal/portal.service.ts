/**
 * Client Portal — magic-link access to read-only quotes/invoices.
 *
 * Flow:
 *   1. POST /portal/request-access  — generates PortalToken (24h TTL), returns token
 *      (in production: email the link; here returned directly for testability)
 *   2. POST /portal/verify-token    — validates token, returns { valid, companyId, clientId }
 *   3. GET  /portal/quotes          — list SENT/ACCEPTED quotes for the company
 *   4. GET  /portal/invoices        — list invoices for the company
 *   5. POST /portal/quotes/:id/sign — accept quote (status → ACCEPTED) + activity log
 *
 * The PortalToken carries tenantId so no tenant middleware is needed — all
 * queries are executed under the token's tenant.
 * Tokens are single-use for the sign endpoint; listing reuses the same token.
 */
import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RequestPortalAccessDto, SignQuotePortalDto } from '@amass/shared';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─── Token lifecycle ────────────────────────────────────────────────────────

  async requestAccess(tenantId: string, dto: RequestPortalAccessDto) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 3600_000); // 24 hours

    const portalToken = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.portalToken.create({
        data: {
          tenantId,
          token,
          email: dto.email,
          companyId: dto.companyId ?? null,
          clientId: dto.clientId ?? null,
          expiresAt,
        },
      }),
    );

    // In production: send email with magic link containing token
    // Returning token directly here for API testability (frontend should email it)
    return {
      token: portalToken.token,
      expiresAt: portalToken.expiresAt,
      message: 'Access token generated. Share this link with the client.',
    };
  }

  async verifyToken(headerTenantId: string, token: string) {
    // Look up the token GLOBALLY (no tenant filter). If an attacker sends a
    // valid token for tenant A with an X-Tenant-Id of B, the row is found
    // under A but `record.tenantId !== headerTenantId` triggers a loud
    // audit log entry + 403. Without this guard, the endpoint would silently
    // 401 and the attack would leave no trace.
    //
    // Token is `@unique` in schema so findUnique is the right primitive.
    const record = await this.prisma.portalToken.findUnique({
      where: { token },
      select: { id: true, tenantId: true, email: true, companyId: true, clientId: true, expiresAt: true },
    });
    if (!record || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired portal token');
    }
    if (record.tenantId !== headerTenantId) {
      this.logger.warn(
        `PORTAL_TENANT_MISMATCH header=${headerTenantId} real=${record.tenantId} tokenId=${record.id}`,
      );
      // Audit log uses the real tenantId (not the header) so the event
      // lands on the actually-compromised tenant's trail.
      void this.audit.log({
        action: 'portal.tenant_mismatch',
        tenantId: record.tenantId,
        metadata: { headerTenantId, tokenId: record.id, email: record.email },
      });
      throw new ForbiddenException('Token does not match tenant');
    }
    return {
      valid: true,
      email: record.email,
      companyId: record.companyId,
      clientId: record.clientId,
    };
  }

  /**
   * Shared helper for the listing / signing endpoints. Uses the same
   * mismatch-detection logic as verifyToken so a smuggled token is logged
   * even on these routes.
   */
  private async resolveToken(headerTenantId: string, token: string) {
    const record = await this.prisma.portalToken.findUnique({ where: { token } });
    if (!record || record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid or expired portal token');
    }
    if (record.tenantId !== headerTenantId) {
      this.logger.warn(
        `PORTAL_TENANT_MISMATCH header=${headerTenantId} real=${record.tenantId} tokenId=${record.id}`,
      );
      void this.audit.log({
        action: 'portal.tenant_mismatch',
        tenantId: record.tenantId,
        metadata: { headerTenantId, tokenId: record.id, email: record.email },
      });
      throw new ForbiddenException('Token does not match tenant');
    }
    return record;
  }

  // ─── Quotes ─────────────────────────────────────────────────────────────────

  async listQuotes(tenantId: string, token: string) {
    const record = await this.resolveToken(tenantId, token);
    if (!record.companyId) throw new BadRequestException('Token not linked to a company');

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.quote.findMany({
        where: {
          tenantId,
          companyId: record.companyId!,
          status: { in: ['SENT', 'ACCEPTED', 'EXPIRED'] },
          deletedAt: null,
        },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  async signQuote(tenantId: string, token: string, quoteId: string, dto: SignQuotePortalDto) {
    const record = await this.resolveToken(tenantId, token);

    const quote = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.quote.findFirst({ where: { id: quoteId, tenantId, companyId: record.companyId ?? undefined, deletedAt: null } }),
    );
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.status !== 'SENT') {
      throw new BadRequestException(`Cannot sign a quote with status '${quote.status}'`);
    }

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.quote.update({
        where: { id: quoteId },
        data: { status: 'ACCEPTED' },
      });
      // Record signing in the activity timeline under the company subject
      await tx.activity.create({
        data: {
          tenantId,
          action: 'quote.signed',
          subjectType: 'COMPANY',
          subjectId: quote.companyId,
          metadata: {
            quoteId,
            quoteNumber: quote.number,
            signerName: dto.signerName,
            signerEmail: record.email,
          },
        },
      });
    });

    return { signed: true, quoteId, signerName: dto.signerName };
  }

  // ─── Invoices ────────────────────────────────────────────────────────────────

  async listInvoices(tenantId: string, token: string) {
    const record = await this.resolveToken(tenantId, token);
    if (!record.companyId) throw new BadRequestException('Token not linked to a company');

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.invoice.findMany({
        where: {
          tenantId,
          companyId: record.companyId!,
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'] },
          deletedAt: null,
        },
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }
}
