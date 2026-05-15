import { Test } from '@nestjs/testing';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuditService } from '../audit/audit.service';
import { ScimAdminController } from './scim-admin.controller';
import { ScimTokenService } from './scim-token.service';

/**
 * Tests for the JWT-protected admin surface: list / create / revoke SCIM
 * tokens. The JwtAuthGuard is stubbed so we don't need a real JWT + Redis.
 * The token service is fully mocked — its own spec covers behavior.
 */

class StubJwtGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();
    // Inject a fake authenticated user. RolesGuard reads `req.user.role`.
    req.user = {
      userId: 'user-1',
      tenantId: 'tenant-A',
      email: 'admin@x.com',
      role: UserRole.OWNER,
      jti: 'jti-1',
      exp: 9999999999,
    };
    return true;
  }
}

describe('ScimAdminController', () => {
  let app: INestApplication;
  const tokens = {
    list: vi.fn(),
    create: vi.fn(),
    revoke: vi.fn(),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ScimAdminController],
      providers: [
        { provide: ScimTokenService, useValue: tokens },
        { provide: AuditService, useValue: audit },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubJwtGuard)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /scim/tokens lists current tenant tokens (metadata only)', async () => {
    tokens.list.mockResolvedValue([
      {
        id: 'tok-1',
        name: 'Okta production',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    const res = await request(app.getHttpServer()).get('/scim/tokens');
    expect(res.status).toBe(200);
    expect(tokens.list).toHaveBeenCalledWith('tenant-A');
    expect(res.body[0].id).toBe('tok-1');
    expect(res.body[0].name).toBe('Okta production');
    // Defensive: response must NOT leak a token / hash even if the service
    // were misconfigured to return one.
    expect(res.body[0].token).toBeUndefined();
    expect(res.body[0].tokenHash).toBeUndefined();
  });

  it('POST /scim/tokens creates + returns raw token with warning + audit log', async () => {
    tokens.create.mockResolvedValue({
      id: 'tok-2',
      name: 'New Integration',
      token: 'raw-secret-abc',
      createdAt: new Date('2026-05-15T12:00:00Z'),
    });
    const res = await request(app.getHttpServer())
      .post('/scim/tokens')
      .send({ name: 'New Integration' });
    expect(res.status).toBe(201);
    expect(tokens.create).toHaveBeenCalledWith('tenant-A', 'New Integration');
    expect(res.body.token).toBe('raw-secret-abc');
    expect(res.body.warning).toMatch(/won't be shown again|will not be shown/i);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-A',
        actorId: 'user-1',
        action: 'scim.token_created',
        subjectId: 'tok-2',
      }),
    );
  });

  it('POST /scim/tokens rejects missing/empty name with 400', async () => {
    const res = await request(app.getHttpServer()).post('/scim/tokens').send({});
    expect(res.status).toBe(400);
    expect(tokens.create).not.toHaveBeenCalled();
  });

  it('DELETE /scim/tokens/:id revokes + emits audit + returns 204', async () => {
    const revokedAt = new Date('2026-05-15T13:00:00Z');
    tokens.revoke.mockResolvedValue({ id: 'tok-9', revokedAt });
    const res = await request(app.getHttpServer()).delete('/scim/tokens/tok-9');
    expect(res.status).toBe(204);
    expect(tokens.revoke).toHaveBeenCalledWith('tenant-A', 'tok-9');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-A',
        actorId: 'user-1',
        action: 'scim.token_revoked',
        subjectId: 'tok-9',
        metadata: { revokedAt: revokedAt.toISOString() },
      }),
    );
  });
});
