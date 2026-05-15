import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';
import { SCIM_USER_SCHEMA_URN } from './scim.dto';

/**
 * Controller tests assert routing + tenant-header gate + delegation to the
 * service. The service itself is mocked — its own spec covers behavior.
 */

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

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ScimController],
      providers: [{ provide: ScimService, useValue: svc }],
    }).compile();
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
      .set('x-tenant-id', 'tenant-A')
      .query({ startIndex: '2', count: '10', filter: 'userName eq "a@x.com"' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(svc.listUsers).toHaveBeenCalledWith('tenant-A', 2, 10, 'userName eq "a@x.com"');
  });

  it('GET /scim/v2/Users without X-Tenant-Id returns 400', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/Users');
    expect(res.status).toBe(400);
    expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
  });

  it('GET /scim/v2/Users/:id delegates to ScimService.getUser', async () => {
    svc.getUser.mockResolvedValue(fakeScimUser('u9'));
    const res = await request(app.getHttpServer())
      .get('/scim/v2/Users/u9')
      .set('x-tenant-id', 'tenant-A');
    expect(res.status).toBe(200);
    expect(svc.getUser).toHaveBeenCalledWith('tenant-A', 'u9');
    expect(res.body.id).toBe('u9');
  });

  it('POST /scim/v2/Users validates body via Zod and returns 201', async () => {
    svc.createUser.mockResolvedValue(fakeScimUser('new-id'));
    const res = await request(app.getHttpServer())
      .post('/scim/v2/Users')
      .set('x-tenant-id', 'tenant-A')
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
      .set('x-tenant-id', 'tenant-A')
      .send({ schemas: [], userName: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(svc.createUser).not.toHaveBeenCalled();
  });

  it('PUT /scim/v2/Users/:id delegates to ScimService.replaceUser', async () => {
    svc.replaceUser.mockResolvedValue(fakeScimUser('u1'));
    const res = await request(app.getHttpServer())
      .put('/scim/v2/Users/u1')
      .set('x-tenant-id', 'tenant-A')
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
      .set('x-tenant-id', 'tenant-A')
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
      .set('x-tenant-id', 'tenant-A');
    expect(res.status).toBe(204);
    expect(svc.deleteUser).toHaveBeenCalledWith('tenant-A', 'u1');
  });
});

/**
 * Sanity unit test for the controller's tenant gate independent of HTTP —
 * we instantiate it directly and assert it throws when the header is empty.
 */
describe('ScimController tenant gate', () => {
  it('throws BadRequest when X-Tenant-Id is missing or blank', async () => {
    const svc = {
      listUsers: vi.fn(),
      getUser: vi.fn(),
      createUser: vi.fn(),
      replaceUser: vi.fn(),
      patchUser: vi.fn(),
      deleteUser: vi.fn(),
    } as unknown as ScimService;
    const c = new ScimController(svc);
    await expect(c.listUsers(undefined, { startIndex: 1, count: 50 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(c.listUsers('   ', { startIndex: 1, count: 50 })).rejects.toThrow(
      BadRequestException,
    );
  });
});
