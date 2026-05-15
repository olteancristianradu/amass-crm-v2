import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScimBearerGuard, type ScimAuthenticatedRequest } from './scim-bearer.guard';
import { ScimController } from './scim.controller';
import { ScimGroupsService } from './scim-groups.service';
import { ScimService } from './scim.service';
import { SCIM_GROUP_SCHEMA_URN, SCIM_USER_SCHEMA_URN } from './scim.dto';

/**
 * Controller tests assert routing + bearer-guard wiring + delegation to the
 * service. The service itself is mocked — its own spec covers behavior.
 *
 * The bearer guard is overridden with a stub that:
 *   - rejects requests without `Authorization: Bearer good-token`
 *   - on success, stamps `req.scimTenantId = 'tenant-A'` (regression-tests
 *     the controller's `req.scimTenantId` path that replaced the old
 *     X-Tenant-Id header lookup).
 */

class StubBearerGuard {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<ScimAuthenticatedRequest>();
    const auth = req.headers.authorization;
    if (auth !== 'Bearer good-token') {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Bearer token invalid or revoked' });
    }
    req.scimTenantId = 'tenant-A';
    req.scimTokenId = 'tok-1';
    return true;
  }
}

function fakeScimUser(id = 'u1') {
  return {
    schemas: [SCIM_USER_SCHEMA_URN],
    id,
    userName: 'a@x.com',
    name: { givenName: 'A', familyName: 'X', formatted: 'A X' },
    emails: [{ value: 'a@x.com', primary: true, type: 'work' as const }],
    active: true,
    meta: {
      resourceType: 'User' as const,
      created: '2026-01-01T00:00:00.000Z',
      lastModified: '2026-01-01T00:00:00.000Z',
      location: `/scim/v2/Users/${id}`,
    },
  };
}

describe('ScimController routes', () => {
  let app: INestApplication;
  const svc = {
    listUsers: vi.fn(),
    getUser: vi.fn(),
    createUser: vi.fn(),
    replaceUser: vi.fn(),
    patchUser: vi.fn(),
    deleteUser: vi.fn(),
  };
  const groups = {
    listGroups: vi.fn(),
    getGroup: vi.fn(),
    createGroup: vi.fn(),
    deleteGroup: vi.fn(),
    patchGroup: vi.fn(),
    replaceGroupMembers: vi.fn(),
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ScimController],
      providers: [
        { provide: ScimService, useValue: svc },
        { provide: ScimGroupsService, useValue: groups },
      ],
    })
      .overrideGuard(ScimBearerGuard)
      .useClass(StubBearerGuard)
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

  it('GET /scim/v2/Users delegates to ScimService.listUsers and sets scim+json content-type', async () => {
    svc.listUsers.mockResolvedValue({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 0,
      startIndex: 1,
      itemsPerPage: 0,
      Resources: [],
    });
    const res = await request(app.getHttpServer())
      .get('/scim/v2/Users')
      .set('authorization', 'Bearer good-token')
      .query({ startIndex: '2', count: '10', filter: 'userName eq "a@x.com"' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(svc.listUsers).toHaveBeenCalledWith('tenant-A', 2, 10, 'userName eq "a@x.com"');
  });

  it('GET /scim/v2/Users without bearer token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/Users');
    expect(res.status).toBe(401);
  });

  it('GET /scim/v2/Users/:id delegates to ScimService.getUser', async () => {
    svc.getUser.mockResolvedValue(fakeScimUser('u9'));
    const res = await request(app.getHttpServer())
      .get('/scim/v2/Users/u9')
      .set('authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(svc.getUser).toHaveBeenCalledWith('tenant-A', 'u9');
    expect(res.body.id).toBe('u9');
  });

  it('POST /scim/v2/Users validates body via Zod and returns 201', async () => {
    svc.createUser.mockResolvedValue(fakeScimUser('new-id'));
    const res = await request(app.getHttpServer())
      .post('/scim/v2/Users')
      .set('authorization', 'Bearer good-token')
      .send({
        schemas: [SCIM_USER_SCHEMA_URN],
        userName: 'new@x.com',
        name: { givenName: 'New', familyName: 'User' },
        emails: [{ value: 'new@x.com', primary: true }],
        active: true,
      });
    expect(res.status).toBe(201);
    expect(svc.createUser).toHaveBeenCalledOnce();
  });

  it('POST /scim/v2/Users rejects malformed body with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/scim/v2/Users')
      .set('authorization', 'Bearer good-token')
      .send({ schemas: [], userName: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(svc.createUser).not.toHaveBeenCalled();
  });

  it('PUT /scim/v2/Users/:id delegates to ScimService.replaceUser', async () => {
    svc.replaceUser.mockResolvedValue(fakeScimUser('u1'));
    const res = await request(app.getHttpServer())
      .put('/scim/v2/Users/u1')
      .set('authorization', 'Bearer good-token')
      .send({
        schemas: [SCIM_USER_SCHEMA_URN],
        userName: 'a@x.com',
        name: { givenName: 'A', familyName: 'X' },
        emails: [{ value: 'a@x.com', primary: true }],
        active: true,
      });
    expect(res.status).toBe(200);
    expect(svc.replaceUser).toHaveBeenCalledOnce();
  });

  it('PATCH /scim/v2/Users/:id delegates to ScimService.patchUser', async () => {
    svc.patchUser.mockResolvedValue(fakeScimUser('u1'));
    const res = await request(app.getHttpServer())
      .patch('/scim/v2/Users/u1')
      .set('authorization', 'Bearer good-token')
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      });
    expect(res.status).toBe(200);
    expect(svc.patchUser).toHaveBeenCalledWith('tenant-A', 'u1', [
      { op: 'replace', path: 'active', value: false },
    ]);
  });

  it('DELETE /scim/v2/Users/:id returns 204 No Content', async () => {
    svc.deleteUser.mockResolvedValue(undefined);
    const res = await request(app.getHttpServer())
      .delete('/scim/v2/Users/u1')
      .set('authorization', 'Bearer good-token');
    expect(res.status).toBe(204);
    expect(svc.deleteUser).toHaveBeenCalledWith('tenant-A', 'u1');
  });

  // ─── /Groups routes (B3-PR2) ──────────────────────────────────────────

  it('GET /scim/v2/Groups delegates to ScimGroupsService.listGroups', async () => {
    groups.listGroups.mockResolvedValue({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 5,
      startIndex: 1,
      itemsPerPage: 5,
      Resources: [],
    });
    const res = await request(app.getHttpServer())
      .get('/scim/v2/Groups')
      .set('authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(groups.listGroups).toHaveBeenCalledWith('tenant-A', 1, 50, undefined);
  });

  it('GET /scim/v2/Groups/:id delegates to ScimGroupsService.getGroup', async () => {
    groups.getGroup.mockResolvedValue({
      schemas: [SCIM_GROUP_SCHEMA_URN],
      id: 'role:ADMIN',
      displayName: 'ADMIN',
      members: [],
      meta: {
        resourceType: 'Group',
        created: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
        location: '/scim/v2/Groups/role:ADMIN',
      },
    });
    const res = await request(app.getHttpServer())
      .get('/scim/v2/Groups/role:ADMIN')
      .set('authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(groups.getGroup).toHaveBeenCalledWith('tenant-A', 'role:ADMIN');
    expect(res.body.id).toBe('role:ADMIN');
  });

  it('POST /scim/v2/Groups returns 501 from ScimGroupsService.createGroup', async () => {
    groups.createGroup.mockImplementation(() => {
      throw new HttpException(
        { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], scimType: 'notImplemented' },
        HttpStatus.NOT_IMPLEMENTED,
      );
    });
    const res = await request(app.getHttpServer())
      .post('/scim/v2/Groups')
      .set('authorization', 'Bearer good-token')
      .send({ schemas: [SCIM_GROUP_SCHEMA_URN], displayName: 'NEW_GROUP', members: [] });
    expect(res.status).toBe(501);
  });

  it('DELETE /scim/v2/Groups/:id returns 501 from ScimGroupsService.deleteGroup', async () => {
    groups.deleteGroup.mockImplementation(() => {
      throw new HttpException(
        { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], scimType: 'notImplemented' },
        HttpStatus.NOT_IMPLEMENTED,
      );
    });
    const res = await request(app.getHttpServer())
      .delete('/scim/v2/Groups/role:ADMIN')
      .set('authorization', 'Bearer good-token');
    expect(res.status).toBe(501);
  });

  it('PATCH /scim/v2/Groups/:id delegates to ScimGroupsService.patchGroup', async () => {
    groups.patchGroup.mockResolvedValue({
      schemas: [SCIM_GROUP_SCHEMA_URN],
      id: 'role:ADMIN',
      displayName: 'ADMIN',
      members: [{ value: 'u1', display: 'A', $ref: '/scim/v2/Users/u1', type: 'User' }],
      meta: {
        resourceType: 'Group',
        created: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
        location: '/scim/v2/Groups/role:ADMIN',
      },
    });
    const res = await request(app.getHttpServer())
      .patch('/scim/v2/Groups/role:ADMIN')
      .set('authorization', 'Bearer good-token')
      .send({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'add', path: 'members', value: [{ value: 'u1' }] }],
      });
    expect(res.status).toBe(200);
    expect(groups.patchGroup).toHaveBeenCalledWith('tenant-A', 'role:ADMIN', [
      { op: 'add', path: 'members', value: [{ value: 'u1' }] },
    ]);
  });

  it('PUT /scim/v2/Groups/:id delegates to ScimGroupsService.replaceGroupMembers', async () => {
    groups.replaceGroupMembers.mockResolvedValue({
      schemas: [SCIM_GROUP_SCHEMA_URN],
      id: 'role:ADMIN',
      displayName: 'ADMIN',
      members: [],
      meta: {
        resourceType: 'Group',
        created: '2026-01-01T00:00:00.000Z',
        lastModified: '2026-01-01T00:00:00.000Z',
        location: '/scim/v2/Groups/role:ADMIN',
      },
    });
    const res = await request(app.getHttpServer())
      .put('/scim/v2/Groups/role:ADMIN')
      .set('authorization', 'Bearer good-token')
      .send({
        schemas: [SCIM_GROUP_SCHEMA_URN],
        displayName: 'ADMIN',
        members: [{ value: 'u1' }],
      });
    expect(res.status).toBe(200);
    expect(groups.replaceGroupMembers).toHaveBeenCalledOnce();
  });

  it('GET /scim/v2/Groups without bearer token returns 401', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/Groups');
    expect(res.status).toBe(401);
  });

  it('GET /scim/v2/Users still works under bearer auth (B3-PR3 regression)', async () => {
    // Explicit regression test: the entire SCIM /Users surface continues to
    // function after the X-Tenant-Id → bearer-token swap. We assert the
    // tenant comes from the guard (req.scimTenantId), not from a header.
    svc.listUsers.mockResolvedValue({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      startIndex: 1,
      itemsPerPage: 1,
      Resources: [
        {
          schemas: [SCIM_USER_SCHEMA_URN],
          id: 'regression-1',
          userName: 'r@x.com',
          name: { givenName: 'R', familyName: 'X' },
          emails: [{ value: 'r@x.com', primary: true }],
          active: true,
          meta: {
            resourceType: 'User',
            created: '2026-01-01T00:00:00.000Z',
            lastModified: '2026-01-01T00:00:00.000Z',
            location: '/scim/v2/Users/regression-1',
          },
        },
      ],
    });
    const res = await request(app.getHttpServer())
      .get('/scim/v2/Users')
      .set('authorization', 'Bearer good-token');
    expect(res.status).toBe(200);
    expect(svc.listUsers).toHaveBeenCalledWith('tenant-A', 1, 50, undefined);
    expect(res.body.Resources[0].id).toBe('regression-1');
  });
});

/**
 * Sanity unit test for the controller's tenant gate independent of HTTP —
 * we instantiate it directly and assert it throws when the request has no
 * scimTenantId attached (i.e. the bearer guard was misconfigured).
 */
describe('ScimController tenant gate', () => {
  it('throws Unauthorized when req.scimTenantId is missing', async () => {
    const svc = {
      listUsers: vi.fn(),
      getUser: vi.fn(),
      createUser: vi.fn(),
      replaceUser: vi.fn(),
      patchUser: vi.fn(),
      deleteUser: vi.fn(),
    } as unknown as ScimService;
    const groups = {
      listGroups: vi.fn(),
      getGroup: vi.fn(),
      createGroup: vi.fn(),
      deleteGroup: vi.fn(),
      patchGroup: vi.fn(),
      replaceGroupMembers: vi.fn(),
    } as unknown as ScimGroupsService;
    const c = new ScimController(svc, groups);
    const reqWithout = { headers: {} } as unknown as ScimAuthenticatedRequest;
    await expect(c.listUsers(reqWithout, { startIndex: 1, count: 50 })).rejects.toThrow(
      UnauthorizedException,
    );
    // Same gate applies to /Groups routes.
    await expect(c.listGroups(reqWithout, { startIndex: 1, count: 50 })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
