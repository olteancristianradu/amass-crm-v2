import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as qrcode from 'qrcode';
import { generateSecret, generateURI, verify as otpVerify } from 'otplib';
import { encrypt, decrypt } from '../../common/crypto/encryption';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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

  async enable(userId: string, tenantId: string, code: string): Promise<void> {
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

    await this.prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
    await this.audit.log({ tenantId, actorId: userId, action: 'auth.totp.enabled', subjectType: 'user', subjectId: userId });
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
