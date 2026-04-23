import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateToken, hashToken, isTokenUsable, tokenTtl } from './password-reset.helpers';

const TOKEN_TTL_MINUTES = 24 * 60; // 24h

/**
 * Email verification flow.
 *
 *   issue(userId) — called from register() and on email change.
 *     → issues a token, stores the hash, returns the raw token so the
 *       email service can ship it.
 *
 *   confirm(rawToken)
 *     → atomically marks token used and sets emailVerifiedAt on the user.
 *     → idempotent: if the user is already verified, still consumes the
 *       token so it cannot be replayed.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async issue(userId: string, tenantId: string): Promise<{ verifyUrl: string }> {
    const { raw, hash } = generateToken();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.emailVerificationToken.create({
        data: { userId, tokenHash: hash, expiresAt: tokenTtl(TOKEN_TTL_MINUTES) },
      }),
    );
    await this.audit.log({
      tenantId,
      actorId: userId,
      action: 'auth.email_verification.issued',
      subjectType: 'User',
      subjectId: userId,
    });
    return { verifyUrl: raw };
  }

  async confirm(rawToken: string): Promise<void> {
    const hash = hashToken(rawToken);
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hash } });
    if (!row || !isTokenUsable(row)) {
      throw new BadRequestException({
        code: 'VERIFICATION_TOKEN_INVALID',
        message: 'Verification token is expired, already used, or unknown',
      });
    }
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user) {
      throw new BadRequestException({
        code: 'VERIFICATION_TOKEN_INVALID',
        message: 'Verification token is expired, already used, or unknown',
      });
    }

    await this.prisma.runWithTenant(user.tenantId, async (tx) => {
      const marked = await tx.emailVerificationToken.updateMany({
        where: { tokenHash: hash, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (marked.count === 0) {
        throw new BadRequestException({
          code: 'VERIFICATION_TOKEN_INVALID',
          message: 'Verification token already consumed',
        });
      }
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    });

    await this.audit.log({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.email_verification.confirmed',
      subjectType: 'User',
      subjectId: user.id,
    });
  }
}
