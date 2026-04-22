import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ScimModule } from './scim.module';

/**
 * Regression test for the dual-@All decorator bug: stacking two @All
 * decorators on the same method silently dropped the collection route
 * (`/scim/v2/:resource`). Both the collection and item routes must return
 * 501 with the SCIM error envelope.
 */
describe('ScimController routing', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [ScimModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /scim/v2/Users (collection) returns 501 with SCIM envelope', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/Users');
    expect(res.status).toBe(501);
    expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(res.body.status).toBe('501');
    expect(res.body.detail).toContain('Users');
  });

  it('GET /scim/v2/Users/abc123 (item) returns 501 with SCIM envelope', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/Users/abc123');
    expect(res.status).toBe(501);
    expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    expect(res.body.detail).toContain('Users/abc123');
  });

  it('POST /scim/v2/Groups also returns 501 (verifies @All covers non-GET verbs)', async () => {
    const res = await request(app.getHttpServer()).post('/scim/v2/Groups').send({ displayName: 'x' });
    expect(res.status).toBe(501);
  });
});
