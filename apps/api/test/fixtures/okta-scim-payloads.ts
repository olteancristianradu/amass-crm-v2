/**
 * Real-shape SCIM payloads captured from Okta's SCIM 2.0 connector docs.
 *
 * These are used by `test/scim-okta-flow.e2e.spec.ts` to drive the API
 * exactly the way Okta would in a sandbox tenant. The shapes intentionally
 * include attributes our service does NOT consume (Okta-specific extensions,
 * `externalId`, secondary emails, `phoneNumbers`) so the test proves we
 * tolerate them gracefully — Zod's strict-parse drops unknown keys instead
 * of 400ing the IdP.
 *
 * Sources cross-referenced:
 *   - https://developer.okta.com/docs/reference/scim/scim-20/
 *   - RFC 7643 §4.1 (User), §4.2 (Group)
 *   - Okta's "SCIM 2.0 Test App (Header Auth)" sample payloads
 *
 * NEVER embed real Okta credentials, tenant ids, or org domains here. The
 * `alice@example.com` user and the bearer-token "okta-fixture-token" placeholder
 * are inert.
 */

import {
  SCIM_GROUP_SCHEMA_URN,
  SCIM_PATCH_OP_SCHEMA_URN,
  SCIM_USER_SCHEMA_URN,
} from '../../src/modules/scim/scim.dto';

/**
 * Okta-shaped POST /scim/v2/Users body. Includes `externalId`, secondary
 * `emails`, `phoneNumbers`, and the Okta enterprise extension — none of which
 * we persist, but all of which Okta routinely sends. The Zod schema in
 * `scim.dto.ts` does not `.passthrough()`, so unknown keys are silently
 * dropped (RFC 7644 §3.1 — "Service providers MAY accept and discard").
 */
export const oktaUserCreate = {
  schemas: [
    SCIM_USER_SCHEMA_URN,
    // Okta sends this enterprise extension on every create. We don't store
    // employeeNumber/department, but the payload must not crash validation.
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
  ],
  externalId: '00u1abcd2EFGHIJ34kl5', // Okta's internal user id; we ignore it.
  userName: 'alice@example.com',
  name: {
    givenName: 'Alice',
    familyName: 'Wonder',
    formatted: 'Alice Wonder',
  },
  emails: [
    { primary: true, value: 'alice@example.com', type: 'work' },
    { primary: false, value: 'alice.personal@example.com', type: 'home' },
  ],
  displayName: 'Alice Wonder',
  locale: 'en-US',
  active: true,
  phoneNumbers: [{ primary: true, value: '+40 700 000 000', type: 'mobile' }],
  'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
    employeeNumber: 'E-1042',
    department: 'Sales',
  },
} as const;

/**
 * Okta-shaped PATCH to deprovision a user (set active=false). Okta uses
 * `replace` with path `active` and a boolean value. This is the EXACT shape
 * that lands in our service when a user is removed from the SCIM app in Okta.
 */
export const oktaUserPatchActive = {
  schemas: [SCIM_PATCH_OP_SCHEMA_URN],
  Operations: [{ op: 'replace', path: 'active', value: false }],
} as const;

/**
 * Okta-shaped PATCH to rename a user — exercises `name.givenName` /
 * `name.familyName` paths simultaneously, which is how Okta pushes profile
 * updates when an HR system writes back into Okta.
 */
export const oktaUserPatchName = {
  schemas: [SCIM_PATCH_OP_SCHEMA_URN],
  Operations: [
    { op: 'replace', path: 'name.givenName', value: 'Alicia' },
    { op: 'replace', path: 'name.familyName', value: 'Wonderland' },
  ],
} as const;

/**
 * Okta-shaped Group GET response — what Okta expects to read back from
 * `GET /scim/v2/Groups/:id`. Tests assert the shape we emit matches this
 * envelope (schemas/id/displayName/members[]/meta).
 */
export const oktaGroupGet = {
  schemas: [SCIM_GROUP_SCHEMA_URN],
  id: 'role:ADMIN',
  displayName: 'ADMIN',
  members: [] as Array<{ value: string; display?: string; $ref: string; type: 'User' }>,
  meta: {
    resourceType: 'Group',
    location: '/scim/v2/Groups/role:ADMIN',
  },
} as const;

/**
 * Okta-shaped PATCH to add a user to a group. Okta uses `add` on path
 * `members` with an array of `{value: userId}`. We map this to a
 * `User.role = ADMIN` write on the matching user row.
 */
export function oktaGroupAddMember(userId: string) {
  return {
    schemas: [SCIM_PATCH_OP_SCHEMA_URN],
    Operations: [
      {
        op: 'add',
        path: 'members',
        value: [{ value: userId, display: 'Alice Wonder' }],
      },
    ],
  } as const;
}

/**
 * Okta-shaped legacy PATCH to remove a single member — the
 * `members[value eq "id"]` path filter form. Okta still emits this for older
 * SCIM apps; the new form is `op:remove, path:members, value:[{value:id}]`.
 * Our parser supports both — we test the legacy form here so a regression in
 * `parseGroupPatchOps` would fail loud.
 */
export function oktaGroupRemoveMemberLegacy(userId: string) {
  return {
    schemas: [SCIM_PATCH_OP_SCHEMA_URN],
    Operations: [{ op: 'remove', path: `members[value eq "${userId}"]` }],
  } as const;
}

/**
 * Okta-shaped SCIM error envelope (RFC 7644 §3.12). Tests assert that the
 * shape our `scimType: invalidFilter` etc. responses produce matches what
 * Okta's IdP error parser expects.
 */
export const oktaErrorPayload = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
  status: '400',
  scimType: 'invalidFilter',
  detail: 'Filter expression not supported',
} as const;

/**
 * A complex filter Okta sometimes sends when reconciling deltas. We DO NOT
 * support this (B3-PR1 only handles `userName eq "x"`), so the test asserts
 * we return 400 with `scimType: invalidFilter` — the runbook documents the
 * limitation + workaround (use Okta's "Profile sourcing → On-demand provision"
 * instead of "Import everything" which forces complex filters).
 */
export const oktaComplexFilter =
  'active eq true and (userName co "@example.com" or emails.value sw "alice")';
