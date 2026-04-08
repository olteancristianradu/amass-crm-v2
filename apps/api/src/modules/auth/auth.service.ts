import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto';

export interface JwtPayload {
  sub: string; // userId
  tid: string; // tenantId
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    // First user of a new tenant becomes OWNER. If the slug exists, this is treated as
    // an attempt to add a user to an existing tenant — for now we reject it (multi-user
    // invite flow lands in a later sprint).
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (existing) {
      throw new ConflictException({ code: 'TENANT_EXISTS', message: 'Tenant slug already taken' });
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: dto.tenantSlug, name: dto.tenantName ?? dto.tenantSlug },
      });
      return tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
          passwordHash,
          fullName: dto.fullName,
          role: UserRole.OWNER,
        },
      });
    });

    const tokens = await this.issueTokens(user);
    await this.audit.log({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.register',
      subjectType: 'user',
      subjectId: user.id,
    });
    return { user: toSafeUser(user), tokens };
  }

  async login(dto: LoginDto, meta: SessionMeta = {}): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (!tenant) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });

    const tokens = await this.issueTokens(user, meta);
    await this.audit.log({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'auth.login',
      subjectType: 'user',
      subjectId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { user: toSafeUser(user), tokens };
  }

  /**
   * Rotate the refresh token. Returns the SAME `{ tokens }` shape as
   * register/login so all auth endpoints share one client-side parser.
   * The `user` field is intentionally omitted on refresh — the client
   * already has it from the original login and a refresh shouldn't
   * trigger an unrelated user re-fetch.
   */
  async refresh(dto: RefreshDto, meta: SessionMeta = {}): Promise<{ tokens: AuthTokens }> {
    const hash = hashToken(dto.refreshToken);
    const session = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Refresh token invalid or expired' });
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Refresh token invalid or expired' });
    }

    // Rotate: revoke old, issue new. Single-use refresh tokens prevent replay attacks.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user, meta);
    return { tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = hashToken(refreshToken);
    await this.prisma.session
      .update({ where: { refreshTokenHash: hash }, data: { revokedAt: new Date() } })
      .catch(() => undefined); // idempotent
  }

  async me(userId: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user ? toSafeUser(user) : null;
  }

  // ---- internal ----

  private async issueTokens(user: User, meta: SessionMeta = {}): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      tid: user.tenantId,
      email: user.email,
      role: user.role,
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });

    // Refresh token is an opaque random string — we never JWT-sign it. We store its
    // SHA-256 hash so a DB leak doesn't expose usable tokens.
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        refreshTokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: parseTtlSeconds(this.env.JWT_ACCESS_TTL),
    };
  }
}

export interface SafeUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
}

interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    tenantId: u.tenantId,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
  };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseTtlSeconds(ttl: string): number {
  // Supports "15m", "1h", "30s", "2d". Returns seconds.
  const m = /^(\d+)([smhd])$/.exec(ttl);
  if (!m) return 900;
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return 900;
  }
}
