import { ConflictException, HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'node:crypto';
import { loadEnv } from '../../config/env';
import { RedisService } from '../../infra/redis/redis.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TotpService } from './totp.service';
import { LoginDto, RefreshDto, RegisterDto } from './dto';

export interface JwtPayload {
  sub: string; // userId
  tid: string; // tenantId
  email: string;
  role: string;
  jti: string; // unique token id — used for server-side revocation
  // `exp` is added automatically by @nestjs/jwt from signOptions.expiresIn.
  exp?: number;
}

/** Redis key namespace for revoked access tokens (logout, force-signout). */
export const JWT_BLOCKLIST_PREFIX = 'auth:jwt:blocklist:';

// Bcrypt work factor + lockout policy live in auth.helpers so they're
// unit-testable without spinning up the full auth stack. The re-exports
// here preserve historical import paths.
export { BCRYPT_COST, LEGACY_BCRYPT_COST } from './auth.helpers';
import {
  BCRYPT_COST,
  LOCKOUT_TTL_SECONDS,
  MAX_LOGIN_ATTEMPTS,
  isLegacyBcryptHash,
  lockoutMessage,
} from './auth.helpers';
import { consumeBackupCode } from './totp-backup-codes.helpers';

/**
 * Multi-tenancy note: this service deliberately bypasses `runWithTenant`
 * because it runs **before** a tenant context exists. Login, registration,
 * refresh, and slug-lookup all happen before the JWT that carries tenantId
 * has been minted or verified.
 *
 * Safety compensations applied here:
 *   - every tenant-scoped query explicitly filters by `tenantId` (passed in
 *     from the slug lookup or token payload) — grep-able, reviewable.
 *   - the Prisma extension (Layer 2) still runs at the client boundary and
 *     no-ops when ALS has no context; it won't inject anything here, so
 *     the manual filter is the only safeguard for L2.
 *   - failed login attempts are audit-logged so cross-tenant probing is
 *     visible.
 *
 * Do NOT convert these calls to `runWithTenant` without first introducing
 * a distinct "tenant-less but auth-only" context, otherwise RLS
 * (`SET LOCAL role app_user`) will deny the lookup itself.
 */

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  private readonly env = loadEnv();
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly totpSvc: TotpService,
  ) {}

  async register(dto: RegisterDto): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    // First user of a new tenant becomes OWNER. If the slug exists, this is treated as
    // an attempt to add a user to an existing tenant — for now we reject it (multi-user
    // invite flow lands in a later sprint).
    const existing = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (existing) {
      throw new ConflictException({ code: 'TENANT_EXISTS', message: 'Tenant slug already taken' });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    const user = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { slug: dto.tenantSlug, name: dto.tenantName ?? dto.tenantSlug },
      });
      const owner = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email.toLowerCase(),
          passwordHash,
          fullName: dto.fullName,
          role: UserRole.OWNER,
        },
      });

      // S10: seed a default sales pipeline so the Kanban has something to
      // render on first login. Stages are opinionated (New → Qualified →
      // Negotiation → Won, with a Lost column) and can be renamed/reordered
      // by an admin UI later. `order` has a gap of 10 so inserting a stage
      // in the middle is a cheap UPDATE instead of a re-pack.
      const pipeline = await tx.pipeline.create({
        data: {
          tenantId: tenant.id,
          name: 'Vânzări',
          description: 'Pipeline implicit',
          isDefault: true,
          order: 0,
        },
      });
      await tx.pipelineStage.createMany({
        data: [
          { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Nou', type: 'OPEN', order: 0, probability: 10 },
          { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Calificat', type: 'OPEN', order: 10, probability: 30 },
          { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Negociere', type: 'OPEN', order: 20, probability: 60 },
          { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Câștigat', type: 'WON', order: 30, probability: 100 },
          { tenantId: tenant.id, pipelineId: pipeline.id, name: 'Pierdut', type: 'LOST', order: 40, probability: 0 },
        ],
      });

      return owner;
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
    // M-aud-H6: lockout uses TWO keys, both checked + both incremented.
    //   • per-(tenant,email) — original behaviour, prevents brute-force on a
    //     known account inside a single tenant.
    //   • per-email-globally — prevents the audit's "tenant pivot" attack
    //     where the attacker registers fresh tenants and brute-forces the
    //     same victim email across each one (5 attempts × N tenants).
    // The global counter has a separate TTL/limit so the legit user's
    // typo session in tenant A doesn't lock them out of every other
    // tenant they own.
    const emailLower = dto.email.toLowerCase();
    const lockKey = `auth:lockout:${dto.tenantSlug}:${emailLower}`;
    const failKey = `auth:fails:${dto.tenantSlug}:${emailLower}`;
    const globalLockKey = `auth:lockout:email:${emailLower}`;
    const globalFailKey = `auth:fails:email:${emailLower}`;

    // Check both lockouts upfront before hitting the DB (timing oracle
    // resistance: same shape regardless of which key tripped).
    const [lockTtl, globalLockTtl] = await Promise.all([
      this.redis.ttl(lockKey),
      this.redis.ttl(globalLockKey),
    ]);
    const effectiveLockTtl = Math.max(lockTtl, globalLockTtl);
    if (effectiveLockTtl > 0) {
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: lockoutMessage(effectiveLockTtl) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.tenantSlug } });
    if (!tenant) {
      // Still consume a fail-counter slot to prevent user enumeration via timing.
      await this.recordFailedAttempt(failKey, lockKey, globalFailKey, globalLockKey);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    const user = await this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: dto.email.toLowerCase() } },
    });
    if (!user || !user.isActive) {
      await this.recordFailedAttempt(failKey, lockKey, globalFailKey, globalLockKey);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordFailedAttempt(failKey, lockKey, globalFailKey, globalLockKey);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    // Seamless rehash: users created before the BCRYPT_COST bump have a
    // cost-10 hash. Detect it (format `$2b$10$…`) and rehash with the new
    // cost on successful login. Fire-and-forget — failure here doesn't
    // block the login itself.
    if (isLegacyBcryptHash(user.passwordHash)) {
      bcrypt
        .hash(dto.password, BCRYPT_COST)
        .then((fresh) =>
          this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: fresh } }),
        )
        .catch(() => {/* swallow — best-effort rehash */});
    }

    // If 2FA is enabled, require a valid TOTP code before issuing tokens.
    // We return a specific code so the FE can show the TOTP input instead of
    // a generic error (the FE knows the password was correct at this point).
    //
    // Users who lost their authenticator can submit one of their 10 backup
    // codes in the `totpCode` field instead. Backup codes are stored as
    // SHA-256 digests in user.totpBackupCodes and are single-use — the
    // matched hash is spliced out of the array on consumption.
    if (user.totpEnabled && user.totpSecret) {
      if (!dto.totpCode) {
        throw new UnauthorizedException({ code: 'TOTP_REQUIRED', message: 'Two-factor authentication code required' });
      }
      const totpOk = await this.totpSvc.verify(user.totpSecret, dto.totpCode);
      if (!totpOk) {
        // Fall back to backup code. Format diverges enough (8 alphanum vs
        // 6 digits) that we can try both safely without ambiguity.
        const stored = (user.totpBackupCodes as string[] | null) ?? [];
        const consumed = consumeBackupCode(dto.totpCode, stored);
        if (!consumed.matched) {
          await this.recordFailedAttempt(failKey, lockKey, globalFailKey, globalLockKey);
          throw new UnauthorizedException({ code: 'INVALID_TOTP', message: 'Invalid authenticator code' });
        }
        await this.prisma.user.update({
          where: { id: user.id },
          data: { totpBackupCodes: consumed.remaining as Prisma.InputJsonValue },
        });
        await this.audit.log({
          tenantId: user.tenantId,
          actorId: user.id,
          action: 'auth.totp.backup_code_used',
          subjectType: 'User',
          subjectId: user.id,
          metadata: { remaining: consumed.remaining.length },
        });
      }
    }

    // Successful login — clear failure counters (both per-tenant + global).
    await Promise.all([
      this.redis.del(failKey),
      this.redis.del(lockKey),
      this.redis.del(globalFailKey),
      this.redis.del(globalLockKey),
    ]);

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
   * Increment the per-tenant fail counter AND the global per-email fail
   * counter. Either tripping its threshold lights up its lockout key.
   * The global counter has a higher threshold (3× the per-tenant) so a
   * legit user mistyping in one tenant doesn't lock them out elsewhere,
   * but a tenant-pivot attack still hits the cap quickly.
   */
  private async recordFailedAttempt(
    failKey: string,
    lockKey: string,
    globalFailKey?: string,
    globalLockKey?: string,
  ): Promise<void> {
    const attempts = await this.redis.incr(failKey, LOCKOUT_TTL_SECONDS);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      // Promote to a hard lockout key and clear the counter.
      await this.redis.incr(lockKey, LOCKOUT_TTL_SECONDS);
      await this.redis.del(failKey);
    }
    if (globalFailKey && globalLockKey) {
      const globalAttempts = await this.redis.incr(globalFailKey, LOCKOUT_TTL_SECONDS);
      // Threshold higher to tolerate legit-typo across owned tenants.
      // 5 per tenant × ~3 tenants worth of slack before we hard-lock.
      if (globalAttempts >= MAX_LOGIN_ATTEMPTS * 3) {
        await this.redis.incr(globalLockKey, LOCKOUT_TTL_SECONDS);
        await this.redis.del(globalFailKey);
      }
    }
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
    if (!session) {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Refresh token invalid or expired' });
    }

    // M-aud-H5: refresh-token reuse detection + family revocation.
    //
    // If a refresh token that has ALREADY been revoked is presented again,
    // it almost certainly means an attacker captured the token (XSS, MITM,
    // device steal) and is rotating it from a second location. The legit
    // user already rotated past it on their original session.
    //
    // Industry-standard mitigation (Auth0/Okta): revoke the entire
    // session family — every other active session for the same user.
    // The legit user is forced to re-authenticate, but the attacker's
    // shadow session is killed at the same time. Without this, a stolen
    // refresh-cookie buys 30 days of persistent shadow access.
    if (session.revokedAt) {
      this.logger.warn(
        `Refresh-token reuse detected (session ${session.id}, user ${session.userId}). Revoking all active sessions for this user.`,
      );
      await this.prisma.session.updateMany({
        where: { userId: session.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // audit.log so SecOps gets the signal even if logs are rolled.
      void this.audit.log({
        action: 'auth.refresh_reuse_detected',
        actorId: session.userId,
        subjectType: 'user',
        subjectId: session.userId,
        metadata: { sessionId: session.id, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
      });
      throw new UnauthorizedException({ code: 'INVALID_REFRESH', message: 'Refresh token invalid or expired' });
    }

    if (session.expiresAt < new Date()) {
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

  async logout(refreshToken: string, accessJti?: string, accessExp?: number): Promise<void> {
    const hash = hashToken(refreshToken);
    await this.prisma.session
      .update({ where: { refreshTokenHash: hash }, data: { revokedAt: new Date() } })
      .catch(() => undefined); // idempotent

    // Also add the access token's jti to the Redis blocklist so the access
    // token is rejected immediately instead of remaining valid until its exp.
    if (accessJti && accessExp) {
      await this.revokeAccessJti(accessJti, accessExp);
    }
  }

  /** Blocklist an access token's jti until its natural expiry. */
  async revokeAccessJti(jti: string, expEpochSeconds: number): Promise<void> {
    const ttl = Math.max(1, expEpochSeconds - Math.floor(Date.now() / 1000));
    await this.redis.client.setex(`${JWT_BLOCKLIST_PREFIX}${jti}`, ttl, '1');
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
      jti: randomBytes(16).toString('hex'),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.env.JWT_SECRET,
      expiresIn: parseTtlSeconds(this.env.JWT_ACCESS_TTL),
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

export function parseTtlSeconds(ttl: string): number {
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
