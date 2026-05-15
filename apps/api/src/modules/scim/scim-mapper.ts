import type { Prisma, User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import {
  SCIM_GROUP_SCHEMA_URN,
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

// ─── SCIM Groups (synthetic, role-derived) ──────────────────────────────────

/**
 * SCIM Group envelope shape (RFC 7643 §4.2). Groups in amass-crm are NOT
 * stored — they are synthesized 1:1 from the `UserRole` enum on each request.
 * `meta.created` and `meta.lastModified` are fixed sentinels: the group has
 * no DB row, only its members do.
 */
export interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string; $ref: string; type: 'User' }>;
  meta: {
    resourceType: 'Group';
    created: string;
    lastModified: string;
    location: string;
  };
}

/** Stable sort + iteration order for the 5 synthetic groups. */
export const SCIM_GROUP_ROLES: readonly UserRole[] = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.AGENT,
  UserRole.VIEWER,
] as const;

/** Fixed creation timestamp for synthetic groups — they have no DB row. */
const SYNTHETIC_GROUP_META_TS = '2026-01-01T00:00:00.000Z';

/** Group id <-> Role conversion. Format: `role:OWNER`, `role:ADMIN`, ... */
export function roleToGroupId(role: UserRole): string {
  return `role:${role}`;
}

/**
 * Parse `role:OWNER` back into the UserRole enum value. Returns null for any
 * id that doesn't match a known role — the service uses this to reject
 * GET /Groups/role:UNKNOWN with a clean 404 instead of crashing on enum lookup.
 */
export function groupIdToRole(id: string): UserRole | null {
  if (!id.startsWith('role:')) return null;
  const candidate = id.slice('role:'.length);
  if ((SCIM_GROUP_ROLES as readonly string[]).includes(candidate)) {
    return candidate as UserRole;
  }
  return null;
}

/** Build the SCIM Group envelope from a role + its member User rows. */
export function roleToScimGroup(
  role: UserRole,
  members: Array<Pick<User, 'id' | 'fullName' | 'email'>>,
  locationBase = '/scim/v2/Groups',
  userLocationBase = '/scim/v2/Users',
): ScimGroup {
  const id = roleToGroupId(role);
  return {
    schemas: [SCIM_GROUP_SCHEMA_URN],
    id,
    displayName: role,
    members: members.map((m) => ({
      value: m.id,
      display: m.fullName || m.email,
      $ref: `${userLocationBase}/${m.id}`,
      type: 'User',
    })),
    meta: {
      resourceType: 'Group',
      created: SYNTHETIC_GROUP_META_TS,
      lastModified: SYNTHETIC_GROUP_META_TS,
      location: `${locationBase}/${id}`,
    },
  };
}

/**
 * Membership-removal policy for synthetic Role-groups: when an IdP removes a
 * user from group X (e.g. MANAGER), we downgrade them to VIEWER rather than
 * deleting the User. VIEWER is the least-privilege floor consistent with the
 * SCIM /Users create path (`scimToUserCreateInput` also defaults to VIEWER).
 *
 * Removing a user from the VIEWER group is a no-op — "no role at all" isn't
 * representable (User.role is non-null).
 */
export const GROUP_REMOVAL_FALLBACK_ROLE: UserRole = UserRole.VIEWER;

/**
 * Parse a Groups PatchOp into a list of {userId, action} operations.
 * Supported shapes (matches what Okta + Azure AD actually send):
 *   - `{op:"add", path:"members", value:[{value:userId}, ...]}`
 *   - `{op:"remove", path:"members", value:[{value:userId}, ...]}`
 *   - `{op:"remove", path:'members[value eq "userId"]'}` (Okta legacy form)
 *
 * `replace` on `members` is treated as a full PUT-style overwrite — the
 * service handles that via the dedicated replace path, not this parser.
 */
export interface ScimGroupMemberOp {
  action: 'add' | 'remove';
  userId: string;
}

export function parseGroupPatchOps(ops: ScimPatchOp[]): ScimGroupMemberOp[] {
  const out: ScimGroupMemberOp[] = [];
  for (const op of ops) {
    const action = op.op.toLowerCase();
    if (action !== 'add' && action !== 'remove') {
      const err = new Error('UNSUPPORTED_OP');
      err.name = 'ScimUnsupportedOp';
      throw err;
    }
    const path = op.path ?? '';

    // Okta legacy form: remove single member via path filter expression.
    const filterMatch = path.match(/^members\[value\s+eq\s+["']([^"']+)["']\]$/i);
    if (filterMatch) {
      if (action !== 'remove') {
        const err = new Error('UNSUPPORTED_OP');
        err.name = 'ScimUnsupportedOp';
        throw err;
      }
      out.push({ action: 'remove', userId: filterMatch[1]! });
      continue;
    }

    if (path !== 'members') {
      const err = new Error('UNSUPPORTED_OP');
      err.name = 'ScimUnsupportedOp';
      throw err;
    }

    if (!Array.isArray(op.value)) {
      const err = new Error('UNSUPPORTED_OP');
      err.name = 'ScimUnsupportedOp';
      throw err;
    }
    for (const entry of op.value as unknown[]) {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        typeof (entry as { value?: unknown }).value !== 'string' ||
        ((entry as { value: string }).value).trim() === ''
      ) {
        const err = new Error('UNSUPPORTED_OP');
        err.name = 'ScimUnsupportedOp';
        throw err;
      }
      out.push({ action: action as 'add' | 'remove', userId: (entry as { value: string }).value });
    }
  }
  return out;
}

/**
 * Compute the diff for a PUT /Groups/:id (full member-set overwrite).
 * Returns the userIds that must be added (set User.role to this group's role)
 * and removed (downgrade to VIEWER).
 */
export function diffGroupMembers(
  currentUserIds: string[],
  desiredUserIds: string[],
): { toAdd: string[]; toRemove: string[] } {
  const cur = new Set(currentUserIds);
  const des = new Set(desiredUserIds);
  return {
    toAdd: [...des].filter((id) => !cur.has(id)),
    toRemove: [...cur].filter((id) => !des.has(id)),
  };
}
