import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as qrcode from 'qrcode';
import { generateSecret, generateURI, verify as otpVerify } from 'otplib';
import { Prisma } from '@prisma/client';
import { encrypt, decrypt } from '../../common/crypto/encryption';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateBackupCodes } from './totp-backup-codes.helpers';

/**
 * Multi-tenancy note: TotpService runs partially pre-authentication (the
 * second factor verification during login, before the session JWT is
 * minted), so it deliberately bypasses `runWithTenant`. Every query below
 * filters by the userId resolved from the first-factor step. Same pattern
 * as `AuthService` — see its docstring for the full rationale.
 */
@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async beginSetup(userId: string, tenantId: string): Promise<{
    otpauthUrl: string;
    qrDataUrl: string;
    tempSecret: string;
  }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new UnauthorizedException();
    if (user.totpEnabled) {
      throw new BadRequestException({ code: 'TOTP_ALREADY_ENABLED', message: '2FA is already enabled' });
    }

    const secret = generateSecret({ length: 20 });
    const otpauthUrl = generateURI({ issuer: 'AMASS CRM', label: user.email, secret });
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: encrypt(secret) },
    });

    return { otpauthUrl, qrDataUrl, tempSecret: secret };
  }

  async enable(
    userId: string,
    tenantId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user?.totpSecret) {
      throw new BadRequestException({ code: 'TOTP_NOT_SETUP', message: 'Complete setup first: POST /auth/totp/setup' });
    }
    if (user.totpEnabled) {
      throw new BadRequestException({ code: 'TOTP_ALREADY_ENABLED', message: '2FA is already enabled' });
    }

    const secret = decrypt(user.totpSecret);
    const result = await otpVerify({ token: code, secret });
    if (!result.valid) {
      throw new BadRequestException({ code: 'INVALID_TOTP', message: 'Invalid authenticator code' });
    }

    // B2-PR5: auto-generate 10 backup/recovery codes at enable-time. The raw
    // codes are returned ONCE to the caller — operators are expected to write
    // them down or save to a password manager. Stored as SHA-256 hashes.
    const { raw, hashes } = generateBackupCodes();

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabled: true,
        totpBackupCodes: hashes as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({ tenantId, actorId: userId, action: 'auth.totp.enabled', subjectType: 'user', subjectId: userId });
    return { backupCodes: raw };
  }

  /**
   * B2-PR5: regenerate the 10-code backup list. Used when the user loses
   * their old codes (or has consumed most of them). Replaces the entire
   * stored set — old codes immediately stop working.
   *
   * Password re-confirmation is REQUIRED to prevent a stolen access-token
   * from silently rotating the recovery path away from the legitimate user.
   */
  async regenerateBackupCodes(
    userId: string,
    tenantId: string,
    password: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new UnauthorizedException();
    if (!user.totpEnabled) {
      throw new BadRequestException({ code: 'TOTP_NOT_ENABLED', message: '2FA is not enabled — enable it first to generate backup codes' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_PASSWORD', message: 'Incorrect password' });

    const { raw, hashes } = generateBackupCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpBackupCodes: hashes as Prisma.InputJsonValue },
    });
    await this.audit.log({
      tenantId,
      actorId: userId,
      action: 'auth.totp.backup_codes_regenerated',
      subjectType: 'user',
      subjectId: userId,
      metadata: { count: raw.length },
    });
    return { backupCodes: raw };
  }

  /**
   * B2-PR5: count remaining backup codes (without exposing the codes themselves).
   * Lets the FE warn the user when they're running low.
   */
  async backupCodesRemaining(userId: string, tenantId: string): Promise<{ remaining: number }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { totpBackupCodes: true, totpEnabled: true },
    });
    if (!user || !user.totpEnabled) return { remaining: 0 };
    const codes = (user.totpBackupCodes as string[] | null) ?? [];
    return { remaining: codes.length };
  }

  async disable(userId: string, tenantId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
    if (!user) throw new UnauthorizedException();
    if (!user.totpEnabled) {
      throw new BadRequestException({ code: 'TOTP_NOT_ENABLED', message: '2FA is not enabled' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_PASSWORD', message: 'Incorrect password' });

    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: false, totpSecret: null } });
    await this.audit.log({ tenantId, actorId: userId, action: 'auth.totp.disabled', subjectType: 'user', subjectId: userId });
  }

  async verify(encryptedSecret: string, code: string): Promise<boolean> {
    const secret = decrypt(encryptedSecret);
    const result = await otpVerify({ token: code, secret });
    return result.valid;
  }
}
