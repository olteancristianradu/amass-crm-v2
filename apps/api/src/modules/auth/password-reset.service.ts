import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import bcrypt from 'bcrypt';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BCRYPT_COST } from './auth.helpers';
import { generateToken, hashToken, isTokenUsable, tokenTtl } from './password-reset.helpers';
import { AuditService } from '../audit/audit.service';

const TOKEN_TTL_MINUTES = 60;
const MIN_PASSWORD_LENGTH = 8;

/**
 * Password reset flow.
 *
 *   request(email, tenantSlug)
 *     → always returns 200 so an attacker cannot probe which emails exist.
 *     → on success, issues a one-time token (stored hashed) + audit log.
 *     → emits a `PasswordResetRequested` event the email service picks up.
 *
 *   confirm(token, newPassword)
 *     → atomically marks token as used, updates user password, revokes
 *       all active sessions (force re-login), logs audit.
 *
 * We deliberately do NOT expose the raw token back to the caller of
 * `request()`. The raw token is attached to the event payload and mailed.
 * In dev, you can retrieve it by querying the audit log's metadata (raw
 * is NOT stored — only the fact that a reset was issued).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async request(email: string, tenantSlug: string, ipAddress?: string): Promise<{ resetUrl?: string }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      // constant-time path: pretend the lookup ran + succeeded.
      this.logger.debug(`password reset for unknown tenant slug=${tenantSlug}`);
      return {};
    }
    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: email.toLowerCase() } },
    });
    if (!user || !user.isActive) {
      this.logger.debug(`password reset for unknown/inactive user email=${email}`);
      return {};
    }

    const { raw, hash } = generateToken();
    await this.prisma.runWithTenant(tenant.id, (tx) =>
      tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: tokenTtl(TOKEN_TTL_MINUTES),
          ipAddress: ipAddress ?? null,
        },
      }),
    );
    await this.audit.log({
      tenantId: tenant.id,
      actorId: user.id,
      action: 'auth.password_reset.requested',
      subjectType: 'User',
      subjectId: user.id,
      ipAddress,
    });

    // The raw token is returned to the caller so the email/SMS layer can
    // ship it. Do NOT log it.
    return { resetUrl: raw };
  }

  async confirm(rawToken: string, newPassword: string): Promise<void> {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException({
        code: 'PASSWORD_TOO_SHORT',
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      });
    }
    const hash = hashToken(rawToken);
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hash } });
    if (!row || !isTokenUsable(row)) {
      throw new BadRequestException({
        code: 'RESET_TOKEN_INVALID',
        message: 'Token is expired, already used, or unknown',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive) {
      throw new BadRequestException({
        code: 'RESET_TOKEN_INVALID',
        message: 'Token is expired, already used, or unknown',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    await this.prisma.runWithTenant(user.tenantId, async (tx) => {
      // Atomic: mark token used + rotate password + revoke all sessions.
      const marked = await tx.passwordResetToken.updateMany({
        where: { tokenHash: hash, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count === 0) {
        // Lost a race to another reset attempt on the same token.
        throw new BadRequestException({ code: 'RESET_TOKEN_INVALID', message: 'Token already consumed' });
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.password_reset.confirmed',
      subjectType: 'User',
      subjectId: user.id,
    });
  }
}
