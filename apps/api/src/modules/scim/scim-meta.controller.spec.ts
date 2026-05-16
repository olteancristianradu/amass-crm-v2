import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScimMetaController } from './scim-meta.controller';
import {
  SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA_URN,
  SCIM_SCHEMA_DEFINITION_URN,
  SCIM_RESOURCE_TYPE_SCHEMA_URN,
} from './scim-meta.fixtures';
import {
  SCIM_GROUP_SCHEMA_URN,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
  SCIM_USER_SCHEMA_URN,
} from './scim.dto';

/**
 * B3-PR5 — discovery surface. These endpoints are intentionally public
 * (RFC 7644 §4), so the tests do NOT set up a bearer guard override. The
 * absence of `@UseGuards(ScimBearerGuard)` on the meta controller is itself
 * a load-bearing decision: an IdP wizard probes these endpoints before any
 * credential exists.
 *
 * Coverage:
 *   - GET /ServiceProviderConfig — shape + key capability flags
 *   - GET /Schemas + /Schemas/:id — list + single + 404
 *   - GET /ResourceTypes + /ResourceTypes/:id — list + single + 404
 *   - Content-Type is application/scim+json on every response
 *
 * Note about SCIM_SCHEMA_DEFINITION_URN: imported only to assert it's an
 * exported constant (the fixtures module owns it); not used in a response
 * shape because Schema resources self-describe via their own URN, per
 * RFC 7643 §7.
 */

describe('ScimMetaController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ScimMetaController],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exports the SCIM Schema-definition URN constant', () => {
    expect(SCIM_SCHEMA_DEFINITION_URN).toBe(
      'urn:ietf:params:scim:schemas:core:2.0:Schema',
    );
  });

  // ─── /ServiceProviderConfig ───────────────────────────────────────────

  it('GET /scim/v2/ServiceProviderConfig returns 200 + the right top-level fields', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ServiceProviderConfig');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.body.schemas).toEqual([SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA_URN]);
    // RFC 7644 §5 mandates these top-level groups.
    expect(res.body.patch).toBeDefined();
    expect(res.body.bulk).toBeDefined();
    expect(res.body.filter).toBeDefined();
    expect(res.body.changePassword).toBeDefined();
    expect(res.body.sort).toBeDefined();
    expect(res.body.etag).toBeDefined();
    expect(Array.isArray(res.body.authenticationSchemes)).toBe(true);
    expect(res.body.authenticationSchemes.length).toBeGreaterThan(0);
    expect(res.body.meta.resourceType).toBe('ServiceProviderConfig');
  });

  it('GET /scim/v2/ServiceProviderConfig declares patch.supported = true', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ServiceProviderConfig');
    expect(res.body.patch.supported).toBe(true);
  });

  it('GET /scim/v2/ServiceProviderConfig declares filter.maxResults = 100', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ServiceProviderConfig');
    expect(res.body.filter.supported).toBe(true);
    expect(res.body.filter.maxResults).toBe(100);
  });

  it('GET /scim/v2/ServiceProviderConfig declares bulk + sort + etag + changePassword as UNsupported', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ServiceProviderConfig');
    expect(res.body.bulk.supported).toBe(false);
    expect(res.body.bulk.maxOperations).toBe(0);
    expect(res.body.bulk.maxPayloadSize).toBe(0);
    expect(res.body.sort.supported).toBe(false);
    expect(res.body.etag.supported).toBe(false);
    expect(res.body.changePassword.supported).toBe(false);
  });

  it('GET /scim/v2/ServiceProviderConfig advertises oauthbearertoken as primary auth scheme', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ServiceProviderConfig');
    const scheme = res.body.authenticationSchemes[0];
    expect(scheme.type).toBe('oauthbearertoken');
    expect(scheme.name).toBe('OAuth Bearer Token');
    expect(scheme.primary).toBe(true);
  });

  // ─── /Schemas ─────────────────────────────────────────────────────────

  it('GET /scim/v2/Schemas returns ListResponse with 2 Resources (User + Group)', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/Schemas');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.body.schemas).toEqual([SCIM_LIST_RESPONSE_SCHEMA_URN]);
    expect(res.body.totalResults).toBe(2);
    expect(res.body.itemsPerPage).toBe(2);
    expect(res.body.startIndex).toBe(1);
    expect(Array.isArray(res.body.Resources)).toBe(true);
    expect(res.body.Resources.length).toBe(2);
    const ids = res.body.Resources.map((r: { id: string }) => r.id);
    expect(ids).toContain(SCIM_USER_SCHEMA_URN);
    expect(ids).toContain(SCIM_GROUP_SCHEMA_URN);
  });

  it('GET /scim/v2/Schemas/:knownId returns the schema (User)', async () => {
    const res = await request(app.getHttpServer()).get(
      `/scim/v2/Schemas/${SCIM_USER_SCHEMA_URN}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.body.id).toBe(SCIM_USER_SCHEMA_URN);
    expect(res.body.name).toBe('User');
    expect(Array.isArray(res.body.attributes)).toBe(true);
    const attrNames = res.body.attributes.map((a: { name: string }) => a.name);
    expect(attrNames).toContain('userName');
    expect(attrNames).toContain('name');
    expect(attrNames).toContain('emails');
    expect(attrNames).toContain('active');
  });

  it('GET /scim/v2/Schemas/:knownId returns the schema (Group)', async () => {
    const res = await request(app.getHttpServer()).get(
      `/scim/v2/Schemas/${SCIM_GROUP_SCHEMA_URN}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(SCIM_GROUP_SCHEMA_URN);
    expect(res.body.name).toBe('Group');
    const attrNames = res.body.attributes.map((a: { name: string }) => a.name);
    expect(attrNames).toContain('displayName');
    expect(attrNames).toContain('members');
  });

  it('GET /scim/v2/Schemas/:unknownId returns 404 with a SCIM error envelope', async () => {
    const res = await request(app.getHttpServer()).get(
      '/scim/v2/Schemas/urn:does:not:exist',
    );
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/scim+json');
    // Our global exception filter wraps SCIM errors but the body should
    // still surface the schemas array or our error code; we assert at least
    // that the URN we asked for is mentioned in the response.
    const body = JSON.stringify(res.body);
    expect(body).toContain('urn:does:not:exist');
  });

  // ─── /ResourceTypes ───────────────────────────────────────────────────

  it('GET /scim/v2/ResourceTypes returns ListResponse with User + Group', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ResourceTypes');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.body.totalResults).toBe(2);
    const ids = res.body.Resources.map((r: { id: string }) => r.id);
    expect(ids).toContain('User');
    expect(ids).toContain('Group');
    // Each resource type must declare its schema URN binding.
    const user = res.body.Resources.find((r: { id: string }) => r.id === 'User');
    expect(user.schema).toBe(SCIM_USER_SCHEMA_URN);
    expect(user.endpoint).toBe('/Users');
    expect(user.schemas).toEqual([SCIM_RESOURCE_TYPE_SCHEMA_URN]);
    const group = res.body.Resources.find((r: { id: string }) => r.id === 'Group');
    expect(group.schema).toBe(SCIM_GROUP_SCHEMA_URN);
    expect(group.endpoint).toBe('/Groups');
  });

  it('GET /scim/v2/ResourceTypes/User returns a single User resource type', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ResourceTypes/User');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/scim+json');
    expect(res.body.id).toBe('User');
    expect(res.body.name).toBe('User');
    expect(res.body.endpoint).toBe('/Users');
    expect(res.body.schema).toBe(SCIM_USER_SCHEMA_URN);
    expect(res.body.meta.resourceType).toBe('ResourceType');
  });

  it('GET /scim/v2/ResourceTypes/Group returns a single Group resource type', async () => {
    const res = await request(app.getHttpServer()).get('/scim/v2/ResourceTypes/Group');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('Group');
    expect(res.body.endpoint).toBe('/Groups');
    expect(res.body.schema).toBe(SCIM_GROUP_SCHEMA_URN);
  });

  it('GET /scim/v2/ResourceTypes/:unknownId returns 404', async () => {
    const res = await request(app.getHttpServer()).get(
      '/scim/v2/ResourceTypes/NotARealResource',
    );
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/scim+json');
    const body = JSON.stringify(res.body);
    expect(body).toContain('NotARealResource');
  });

  // ─── Content-Type contract — universal ────────────────────────────────

  it('every meta endpoint sets Content-Type: application/scim+json', async () => {
    const endpoints = [
      '/scim/v2/ServiceProviderConfig',
      '/scim/v2/Schemas',
      `/scim/v2/Schemas/${SCIM_USER_SCHEMA_URN}`,
      '/scim/v2/ResourceTypes',
      '/scim/v2/ResourceTypes/User',
    ];
    for (const ep of endpoints) {
      const res = await request(app.getHttpServer()).get(ep);
      expect(res.status, `endpoint ${ep} status`).toBe(200);
      expect(res.headers['content-type'], `endpoint ${ep} content-type`).toContain(
        'application/scim+json',
      );
    }
  });
});
