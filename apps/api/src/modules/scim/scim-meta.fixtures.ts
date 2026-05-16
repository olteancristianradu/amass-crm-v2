/**
 * SCIM 2.0 discovery fixtures — RFC 7644 §4.
 *
 * These are the static shapes returned by `/ServiceProviderConfig`,
 * `/Schemas`, and `/ResourceTypes`. IdPs (Okta, Azure AD, JumpCloud) hit
 * these endpoints *before* attempting any provisioning calls to learn:
 *
 *   1. Which SCIM features the server actually implements
 *      (e.g. does PATCH work? is filtering supported? bulk? ETags?).
 *   2. The exact attribute schema of each resource type (User, Group) so the
 *      IdP knows which fields it can safely send.
 *   3. The endpoint URL + schema URN binding for each resource type.
 *
 * We hand-author these per RFC 7644 §4 + §8 rather than generating them so:
 *   - The wire shape is locked-in and visible in code review.
 *   - We declare *exactly* the capabilities our /Users + /Groups handlers
 *     support (and just as importantly, what they DON'T — bulk, sort, etag).
 *
 * Field names are case-sensitive per RFC 7644 §3.4 — do NOT rename without
 * re-reading the spec.
 *
 * B3-PR5: meta endpoints. B3 epic complete after this lands.
 */

import {
  SCIM_GROUP_SCHEMA_URN,
  SCIM_LIST_RESPONSE_SCHEMA_URN,
  SCIM_USER_SCHEMA_URN,
} from './scim.dto';

/** URN for the SCIM 2.0 ServiceProviderConfig schema (RFC 7643 §5). */
export const SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA_URN =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';

/** URN for the SCIM 2.0 Schema schema (i.e. a Schema describing a Schema). */
export const SCIM_SCHEMA_DEFINITION_URN = 'urn:ietf:params:scim:schemas:core:2.0:Schema';

/** URN for the SCIM 2.0 ResourceType schema (RFC 7643 §6). */
export const SCIM_RESOURCE_TYPE_SCHEMA_URN =
  'urn:ietf:params:scim:schemas:core:2.0:ResourceType';

/**
 * The ServiceProviderConfig response (RFC 7644 §4 + §5).
 *
 * Declared capabilities reflect what the /Users + /Groups handlers actually
 * do today. Anything marked `supported: false` here is deliberately not
 * implemented (see B3-PR1..PR5 scope) — don't lie to the IdP.
 *
 * - `patch.supported = true`  — both Users and Groups accept PatchOp (within
 *   the narrow op/path allow-list documented in the controller).
 * - `bulk.supported = false`  — we don't process /Bulk; max* are 0 per spec.
 * - `filter.supported = true, maxResults = 100` — /Users supports
 *   `userName eq "..."`; /Groups rejects filter (but the capability is
 *   declared at the service level).
 * - `changePassword.supported = false` — SSO-only path; SCIM-provisioned
 *   users carry a sentinel bcrypt hash that never matches.
 * - `sort.supported = false` — out of scope for v1; results are stable-ordered
 *   server-side by createdAt but the SCIM `sortBy`/`sortOrder` params aren't
 *   honored.
 * - `etag.supported = false` — no concurrency control on writes; last write
 *   wins. Acceptable because the only writer is the IdP itself.
 * - `authenticationSchemes` — opaque bearer (B3-PR3), NOT OAuth2 grant flow.
 *   We label it `oauthbearertoken` because that's the closest RFC 7644 §5
 *   primary identifier most IdP wizards recognize.
 */
export const SERVICE_PROVIDER_CONFIG = {
  schemas: [SCIM_SERVICE_PROVIDER_CONFIG_SCHEMA_URN],
  documentationUri: '/docs/SCIM_OKTA_SETUP.md',
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 100 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'OAuth Bearer Token',
      description:
        'Authentication scheme using the OAuth Bearer Token Standard',
      specUri: 'https://www.rfc-editor.org/info/rfc6750',
      documentationUri: '/docs/SCIM_OKTA_SETUP.md',
      primary: true,
    },
  ],
  meta: {
    resourceType: 'ServiceProviderConfig',
    location: '/scim/v2/ServiceProviderConfig',
  },
} as const;

/**
 * RFC 7643 §8.7.1 — the User schema. We declare only attributes the /Users
 * service actually reads or writes; an IdP that POSTs additional fields is
 * tolerated (Zod silently drops unknowns) but we never advertise them.
 *
 * `mutability`, `required`, `caseExact`, `returned`, `uniqueness`,
 * `multiValued`, `type` are the canonical per-attribute facets — Okta's
 * validator checks for them. Don't trim these even if they feel redundant.
 */
export const SCHEMAS_USER = {
  id: SCIM_USER_SCHEMA_URN,
  name: 'User',
  description: 'SCIM 2.0 core User resource — amass-crm-v2',
  attributes: [
    {
      name: 'userName',
      type: 'string',
      multiValued: false,
      description: 'Unique identifier for the User (email address)',
      required: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'server',
    },
    {
      name: 'name',
      type: 'complex',
      multiValued: false,
      description: "The components of the user's real name",
      required: true,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'givenName',
          type: 'string',
          multiValued: false,
          description: "The given name of the User",
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: 'familyName',
          type: 'string',
          multiValued: false,
          description: "The family name of the User",
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: 'formatted',
          type: 'string',
          multiValued: false,
          description: 'The full name, formatted',
          required: false,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
        },
      ],
    },
    {
      name: 'emails',
      type: 'complex',
      multiValued: true,
      description: 'Email addresses for the user',
      required: true,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          multiValued: false,
          description: 'Email address value',
          required: true,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: 'primary',
          type: 'boolean',
          multiValued: false,
          description: "Whether this is the user's primary email",
          required: false,
          mutability: 'readWrite',
          returned: 'default',
        },
        {
          name: 'type',
          type: 'string',
          multiValued: false,
          description: 'Email type (work, home, other)',
          required: false,
          caseExact: false,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'none',
        },
      ],
    },
    {
      name: 'active',
      type: 'boolean',
      multiValued: false,
      description: "Indicates whether the user is active",
      required: false,
      mutability: 'readWrite',
      returned: 'default',
    },
  ],
  meta: {
    resourceType: 'Schema',
    location: `/scim/v2/Schemas/${SCIM_USER_SCHEMA_URN}`,
  },
} as const;

/**
 * RFC 7643 §8.7.2 — the Group schema.
 *
 * Note: amass-crm Groups are SYNTHETIC, role-derived (see /Groups doc in
 * ARCHITECTURE.md). We still declare the canonical Group attributes
 * (displayName, members.{value,$ref,type,display}) because that's what the
 * IdP expects to see in discovery; runtime mutation semantics differ
 * (POST/DELETE return 501) but the schema shape stays standard.
 */
export const SCHEMAS_GROUP = {
  id: SCIM_GROUP_SCHEMA_URN,
  name: 'Group',
  description:
    'SCIM 2.0 core Group resource — synthetic role-derived groups (5 per tenant, fixed)',
  attributes: [
    {
      name: 'displayName',
      type: 'string',
      multiValued: false,
      description: 'A human-readable name for the Group',
      required: true,
      caseExact: false,
      mutability: 'readWrite',
      returned: 'default',
      uniqueness: 'none',
    },
    {
      name: 'members',
      type: 'complex',
      multiValued: true,
      description: 'A list of members of the Group',
      required: false,
      mutability: 'readWrite',
      returned: 'default',
      subAttributes: [
        {
          name: 'value',
          type: 'string',
          multiValued: false,
          description: "Identifier of the member (User.id)",
          required: false,
          caseExact: false,
          mutability: 'immutable',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: '$ref',
          type: 'reference',
          referenceTypes: ['User'],
          multiValued: false,
          description: 'URI of the member resource',
          required: false,
          caseExact: false,
          mutability: 'immutable',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: 'type',
          type: 'string',
          multiValued: false,
          description: 'Member type (User)',
          required: false,
          caseExact: false,
          canonicalValues: ['User'],
          mutability: 'immutable',
          returned: 'default',
          uniqueness: 'none',
        },
        {
          name: 'display',
          type: 'string',
          multiValued: false,
          description: 'A human-readable display name for the member',
          required: false,
          caseExact: false,
          mutability: 'immutable',
          returned: 'default',
          uniqueness: 'none',
        },
      ],
    },
  ],
  meta: {
    resourceType: 'Schema',
    location: `/scim/v2/Schemas/${SCIM_GROUP_SCHEMA_URN}`,
  },
} as const;

/**
 * RFC 7643 §6 — ResourceType definitions for the User + Group resource
 * endpoints. `endpoint` is RELATIVE (per §6) — clients append it to the SCIM
 * base URL they already know.
 */
export const RESOURCE_TYPE_USER = {
  schemas: [SCIM_RESOURCE_TYPE_SCHEMA_URN],
  id: 'User',
  name: 'User',
  endpoint: '/Users',
  description: 'User Account',
  schema: SCIM_USER_SCHEMA_URN,
  meta: {
    resourceType: 'ResourceType',
    location: '/scim/v2/ResourceTypes/User',
  },
} as const;

export const RESOURCE_TYPE_GROUP = {
  schemas: [SCIM_RESOURCE_TYPE_SCHEMA_URN],
  id: 'Group',
  name: 'Group',
  endpoint: '/Groups',
  description: 'Group',
  schema: SCIM_GROUP_SCHEMA_URN,
  meta: {
    resourceType: 'ResourceType',
    location: '/scim/v2/ResourceTypes/Group',
  },
} as const;

export const RESOURCE_TYPES = [RESOURCE_TYPE_USER, RESOURCE_TYPE_GROUP] as const;

/** All schemas we declare; used by the /Schemas list + /Schemas/:id lookup. */
export const ALL_SCHEMAS = [SCHEMAS_USER, SCHEMAS_GROUP] as const;

/**
 * Build a SCIM ListResponse envelope (RFC 7644 §3.4.2) around a fixed
 * Resources array. Used by both /Schemas and /ResourceTypes since neither
 * supports pagination — totalResults always equals Resources.length.
 */
export function buildListResponse<T>(resources: readonly T[]): {
  schemas: [typeof SCIM_LIST_RESPONSE_SCHEMA_URN];
  totalResults: number;
  itemsPerPage: number;
  startIndex: 1;
  Resources: readonly T[];
} {
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA_URN],
    totalResults: resources.length,
    itemsPerPage: resources.length,
    startIndex: 1,
    Resources: resources,
  };
}
