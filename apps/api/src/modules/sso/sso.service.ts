import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { CreateSsoConfigDto, UpdateSsoConfigDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface SamlProfile {
  nameID?: string;
  [key: string]: unknown;
}

@Injectable()
export class SsoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async getConfig(tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const config = await this.prisma.ssoConfig.findUnique({ where: { tenantId: tenant.id } });
    if (!config || !config.isActive) throw new NotFoundException('SSO not configured for this tenant');
    return { tenant, config };
  }

  async createConfig(tenantId: string, dto: CreateSsoConfigDto) {
    const exists = await this.prisma.ssoConfig.findUnique({ where: { tenantId } });
    if (exists) throw new ConflictException('SSO config already exists for this tenant. Use PATCH to update.');
    return this.prisma.ssoConfig.create({
      data: {
        tenantId,
        idpSsoUrl: dto.idpSsoUrl,
        idpCertificate: dto.idpCertificate,
        spEntityId: dto.spEntityId,
        spPrivateKey: dto.spPrivateKey ?? null,
        attrEmail: dto.attrEmail,
        attrFirstName: dto.attrFirstName,
        attrLastName: dto.attrLastName,
        attrRole: dto.attrRole ?? null,
        isActive: dto.isActive,
      },
    });
  }

  async updateConfig(tenantId: string, dto: UpdateSsoConfigDto) {
    const exists = await this.prisma.ssoConfig.findUnique({ where: { tenantId } });
    if (!exists) throw new NotFoundException('SSO config not found');
    return this.prisma.ssoConfig.update({ where: { tenantId }, data: dto });
  }

  async deleteConfig(tenantId: string) {
    const exists = await this.prisma.ssoConfig.findUnique({ where: { tenantId } });
    if (!exists) throw new NotFoundException('SSO config not found');
    await this.prisma.ssoConfig.delete({ where: { tenantId } });
  }

  /** Called after passport-saml validates the assertion. Provisions user if needed, issues JWT. */
  async handleCallback(tenantSlug: string, profile: SamlProfile): Promise<string> {
    const { tenant, config } = await this.getConfig(tenantSlug);

    const email = profile[config.attrEmail] as string | undefined ?? profile['nameID'];
    if (!email) throw new UnauthorizedException('SAML assertion missing email attribute');

    const firstName = (profile[config.attrFirstName] as string | undefined) ?? '';
    const lastName = (profile[config.attrLastName] as string | undefined) ?? '';
    const roleAttr = config.attrRole ? (profile[config.attrRole] as string | undefined) : undefined;
    const role = this.mapRole(roleAttr);

    // Upsert user — SSO users have no password hash (empty string placeholder)
    let user = await this.prisma.user.findFirst({
      where: { tenantId: tenant.id, email },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          tenantId: tenant.id,
          email,
          passwordHash: '',
          fullName: [firstName, lastName].filter(Boolean).join(' ') || email,
          role,
          isActive: true,
        },
      });
    } else if (!user.isActive) {
      throw new UnauthorizedException('User account is disabled');
    }

    const payload = { sub: user.id, tenantId: tenant.id, role: user.role, slug: tenant.slug };
    return this.jwt.sign(payload, { expiresIn: '15m' });
  }

  private mapRole(rawRole: string | undefined): UserRole {
    if (!rawRole) return UserRole.AGENT;
    const upper = rawRole.toUpperCase();
    if (Object.values(UserRole).includes(upper as UserRole)) return upper as UserRole;
    return UserRole.AGENT;
  }
}
