import type { Prisma, User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import {
  SCIM_USER_SCHEMA_URN,
  type ScimPatchOp,
  type ScimUserCreateDto,
} from './scim.dto';

/**
 * Pure functions that convert between Prisma's `User` row and the SCIM 2.0
 * resource envelope (RFC 7643 §4.1). Kept dependency-free so they unit-test
 * without DI and so the service stays a thin orchestrator.
 *
 * Naming choice: we expose ONLY the primary email in `emails[]` and as
 * `userName`. Multi-email storage isn't in the schema today (User has a
 * single `email` column), so we don't pretend to support it.
 */

export interface ScimUser {
  schemas: string[];
  id: string;
  userName: string;
  name: {
    givenName: string;
    familyName: string;
    formatted: string;
  };
  emails: Array<{ value: string; primary: boolean; type: 'work' }>;
  active: boolean;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location: string;
  };
}

/**
 * Best-effort split of `fullName` into given/family. SCIM IdPs require both
 * fields; our DB stores only the concatenated full name. We split on the
 * LAST space so "Maria Ana Popescu" → given="Maria Ana", family="Popescu",
 * matching the common Romanian/EU convention. Single-word names land
 * entirely in givenName with familyName="-" to satisfy the SCIM minLength
 * constraint on consumer-side schemas.
 */
function splitFullName(fullName: string): { givenName: string; familyName: string } {
  const trimmed = fullName.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) {
    return { givenName: trimmed || '-', familyName: '-' };
  }
  return {
    givenName: trimmed.slice(0, lastSpace),
    familyName: trimmed.slice(lastSpace + 1),
  };
}

/** Build the SCIM envelope from a Prisma User row. */
export function userToScim(user: User, locationBase = '/scim/v2/Users'): ScimUser {
  const { givenName, familyName } = splitFullName(user.fullName);
  return {
    schemas: [SCIM_USER_SCHEMA_URN],
    id: user.id,
    userName: user.email,
    name: {
      givenName,
      familyName,
      formatted: user.fullName,
    },
    emails: [
      {
        value: user.email,
        primary: true,
        type: 'work',
      },
    ],
    active: user.isActive,
    meta: {
      resourceType: 'User',
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      location: `${locationBase}/${user.id}`,
    },
  };
}

/**
 * Build a Prisma `UserCreateInput`-compatible payload from a validated SCIM
 * create body. `tenantId` is intentionally omitted at THIS layer — the
 * tenantExtension injects it at write time when called inside runWithTenant.
 * `passwordHash` is set to a sentinel ("SCIM_PROVISIONED:no-password") so the
 * row satisfies the NOT NULL column constraint while staying unloginable
 * (bcrypt.compare against a non-bcrypt string always returns false).
 *
 * Return type is the unchecked create input minus tenantId; the service
 * casts to `Prisma.UserCreateInput` at the call-site because Prisma's
 * generated type requires either the `tenant` relation or `tenantId`, and
 * the extension supplies the latter at runtime.
 */
export function scimToUserCreateInput(
  scim: ScimUserCreateDto,
): Omit<Prisma.UserUncheckedCreateInput, 'tenantId'> {
  const email = scim.userName.toLowerCase();
  const fullName = `${scim.name.givenName} ${scim.name.familyName}`.trim();
  return {
    email,
    fullName,
    role: UserRole.VIEWER, // SCIM-provisioned users default to least privilege.
    isActive: scim.active ?? true,
    passwordHash: 'SCIM_PROVISIONED:no-password',
  };
}

/**
 * Apply an ordered list of SCIM PatchOp operations to a User row, producing
 * a Prisma `UserUpdateInput`. Throws `Error('UNSUPPORTED_OP')` if the
 * service should respond 400; the service catches and remaps.
 *
 * Supported paths (RFC 7644 §3.5.2 path expressions):
 *   - `active`                                → User.isActive
 *   - `name.givenName` / `name.familyName`    → recompose User.fullName
 *   - `emails[primary eq true].value`         → User.email
 *
 * Supported ops: `replace` only. `add`/`remove` are valid SCIM but their
 * semantics on these scalar paths are ambiguous — IdPs we care about
 * (Okta, Azure AD) send `replace` for these fields, so we keep the surface
 * small and reject the rest until a real customer asks.
 */
export function applyScimPatch(
  currentUser: User,
  ops: ScimPatchOp[],
): Prisma.UserUpdateInput {
  let nextFullName = currentUser.fullName;
  let nextGiven: string | null = null;
  let nextFamily: string | null = null;
  const update: Prisma.UserUpdateInput = {};

  for (const op of ops) {
    const opLower = op.op.toLowerCase();
    if (opLower !== 'replace') {
      const err = new Error('UNSUPPORTED_OP');
      err.name = 'ScimUnsupportedOp';
      throw err;
    }
    const path = op.path;
    if (!path) {
      const err = new Error('UNSUPPORTED_OP');
      err.name = 'ScimUnsupportedOp';
      throw err;
    }

    if (path === 'active') {
      if (typeof op.value !== 'boolean') {
        const err = new Error('UNSUPPORTED_OP');
        err.name = 'ScimUnsupportedOp';
        throw err;
      }
      update.isActive = op.value;
    } else if (path === 'name.givenName') {
      if (typeof op.value !== 'string') {
        const err = new Error('UNSUPPORTED_OP');
        err.name = 'ScimUnsupportedOp';
        throw err;
      }
      nextGiven = op.value;
    } else if (path === 'name.familyName') {
      if (typeof op.value !== 'string') {
        const err = new Error('UNSUPPORTED_OP');
        err.name = 'ScimUnsupportedOp';
        throw err;
      }
      nextFamily = op.value;
    } else if (
      path === 'emails[primary eq true].value' ||
      path === 'emails[type eq "work"].value' ||
      path === 'userName'
    ) {
      if (typeof op.value !== 'string') {
        const err = new Error('UNSUPPORTED_OP');
        err.name = 'ScimUnsupportedOp';
        throw err;
      }
      update.email = op.value.toLowerCase();
    } else {
      const err = new Error('UNSUPPORTED_OP');
      err.name = 'ScimUnsupportedOp';
      throw err;
    }
  }

  if (nextGiven !== null || nextFamily !== null) {
    const existingSplit = splitFullNameForRecompose(currentUser.fullName);
    const given = nextGiven ?? existingSplit.givenName;
    const family = nextFamily ?? existingSplit.familyName;
    nextFullName = `${given} ${family}`.trim();
    update.fullName = nextFullName;
  }

  return update;
}

/** Internal helper — same split rule as `splitFullName`, exported indirectly via tests. */
function splitFullNameForRecompose(fullName: string): { givenName: string; familyName: string } {
  const trimmed = fullName.trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  if (lastSpace === -1) return { givenName: trimmed || '', familyName: '' };
  return { givenName: trimmed.slice(0, lastSpace), familyName: trimmed.slice(lastSpace + 1) };
}

/**
 * Parse the SCIM `filter` query param. We support ONLY `userName eq "x"`
 * (and the case-insensitive variants Okta sends). Any other filter expression
 * returns `null` so the service can throw a 400 with a clear message.
 */
export function parseScimFilter(filter: string): { userName: string } | null {
  // userName eq "value" — quotes can be single or double, whitespace flexible.
  const m = filter.match(/^\s*userName\s+eq\s+["']([^"']+)["']\s*$/i);
  if (!m) return null;
  return { userName: m[1]!.toLowerCase() };
}
