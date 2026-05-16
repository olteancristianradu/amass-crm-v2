import { describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import {
  applyScimPatch,
  diffGroupMembers,
  GROUP_REMOVAL_FALLBACK_ROLE,
  groupIdToRole,
  parseGroupPatchOps,
  parseScimFilter,
  roleToGroupId,
  roleToScimGroup,
  SCIM_GROUP_ROLES,
  scimToUserCreateInput,
  userToScim,
} from './scim-mapper';
import { SCIM_GROUP_SCHEMA_URN, SCIM_USER_SCHEMA_URN } from './scim.dto';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'usr_123',
    tenantId: 'ten_abc',
    email: 'maria@example.com',
    emailVerifiedAt: null,
    passwordHash: 'hash',
    fullName: 'Maria Popescu',
    role: UserRole.VIEWER,
    isActive: true,
    totpSecret: null,
    totpEnabled: false,
    totpBackupCodes: null,
    completedTours: [],
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T11:00:00Z'),
    ...overrides,
  };
}

describe('userToScim', () => {
  it('emits the SCIM core User schema URN and stable envelope shape', () => {
    const out = userToScim(makeUser());
    expect(out.schemas).toEqual([SCIM_USER_SCHEMA_URN]);
    expect(out.id).toBe('usr_123');
    expect(out.userName).toBe('maria@example.com');
    expect(out.active).toBe(true);
    expect(out.meta.resourceType).toBe('User');
    expect(out.meta.location).toBe('/scim/v2/Users/usr_123');
    expect(out.meta.created).toBe('2026-01-01T10:00:00.000Z');
    expect(out.meta.lastModified).toBe('2026-01-02T11:00:00.000Z');
  });

  it('splits fullName on the last space (Romanian convention)', () => {
    const out = userToScim(makeUser({ fullName: 'Maria Ana Popescu' }));
    expect(out.name.givenName).toBe('Maria Ana');
    expect(out.name.familyName).toBe('Popescu');
    expect(out.name.formatted).toBe('Maria Ana Popescu');
  });

  it('handles single-word names without crashing', () => {
    const out = userToScim(makeUser({ fullName: 'Maria' }));
    expect(out.name.givenName).toBe('Maria');
    expect(out.name.familyName).toBe('-');
  });

  it('exposes only one email (primary, work)', () => {
    const out = userToScim(makeUser());
    expect(out.emails).toHaveLength(1);
    expect(out.emails[0]).toEqual({ value: 'maria@example.com', primary: true, type: 'work' });
  });
});

describe('scimToUserCreateInput', () => {
  it('lowercases userName into email', () => {
    const out = scimToUserCreateInput({
      schemas: [SCIM_USER_SCHEMA_URN],
      userName: 'NEW.USER@Example.COM',
      name: { givenName: 'New', familyName: 'User' },
      emails: [{ value: 'NEW.USER@Example.COM', primary: true }],
      active: true,
    });
    expect(out.email).toBe('new.user@example.com');
  });

  it('defaults to VIEWER role and never includes tenantId', () => {
    const out = scimToUserCreateInput({
      schemas: [SCIM_USER_SCHEMA_URN],
      userName: 'a@b.com',
      name: { givenName: 'A', familyName: 'B' },
      emails: [{ value: 'a@b.com', primary: true }],
      active: true,
    });
    expect(out.role).toBe(UserRole.VIEWER);
    expect(out.fullName).toBe('A B');
    expect(out.passwordHash).toContain('SCIM_PROVISIONED');
    // CRITICAL: never include tenantId — the extension stamps it.
    expect('tenantId' in out).toBe(false);
  });

  it('respects active=false on create', () => {
    const out = scimToUserCreateInput({
      schemas: [SCIM_USER_SCHEMA_URN],
      userName: 'a@b.com',
      name: { givenName: 'A', familyName: 'B' },
      emails: [{ value: 'a@b.com', primary: true }],
      active: false,
    });
    expect(out.isActive).toBe(false);
  });
});

describe('applyScimPatch', () => {
  it('replaces active', () => {
    const update = applyScimPatch(makeUser({ isActive: true }), [
      { op: 'replace', path: 'active', value: false },
    ]);
    expect(update.isActive).toBe(false);
  });

  it('replaces name.givenName, preserving family from existing fullName', () => {
    const update = applyScimPatch(makeUser({ fullName: 'Maria Popescu' }), [
      { op: 'replace', path: 'name.givenName', value: 'Mariana' },
    ]);
    expect(update.fullName).toBe('Mariana Popescu');
  });

  it('replaces name.familyName, preserving given from existing fullName', () => {
    const update = applyScimPatch(makeUser({ fullName: 'Maria Popescu' }), [
      { op: 'replace', path: 'name.familyName', value: 'Ionescu' },
    ]);
    expect(update.fullName).toBe('Maria Ionescu');
  });

  it('replaces the primary email value and lowercases it', () => {
    const update = applyScimPatch(makeUser(), [
      { op: 'replace', path: 'emails[primary eq true].value', value: 'NEW@X.COM' },
    ]);
    expect(update.email).toBe('new@x.com');
  });

  it('throws UNSUPPORTED_OP for `add`', () => {
    expect(() =>
      applyScimPatch(makeUser(), [{ op: 'add', path: 'active', value: false }]),
    ).toThrowError(/UNSUPPORTED_OP/);
  });

  it('throws UNSUPPORTED_OP for an unknown path', () => {
    expect(() =>
      applyScimPatch(makeUser(), [{ op: 'replace', path: 'displayName', value: 'X' }]),
    ).toThrowError(/UNSUPPORTED_OP/);
  });

  it('throws UNSUPPORTED_OP when value type does not match path', () => {
    expect(() =>
      applyScimPatch(makeUser(), [{ op: 'replace', path: 'active', value: 'yes' }]),
    ).toThrowError(/UNSUPPORTED_OP/);
  });
});

describe('parseScimFilter', () => {
  it('parses `userName eq "value"`', () => {
    expect(parseScimFilter('userName eq "alice@example.com"')).toEqual({
      attribute: 'userName',
      op: 'eq',
      value: 'alice@example.com',
    });
  });

  it('lowercases the matched value', () => {
    expect(parseScimFilter('userName eq "ALICE@EXAMPLE.COM"')).toEqual({
      attribute: 'userName',
      op: 'eq',
      value: 'alice@example.com',
    });
  });

  it('parses ne (not-equal), sw (starts-with), ew (ends-with), co (contains)', () => {
    expect(parseScimFilter('userName ne "x@y"')).toEqual({
      attribute: 'userName',
      op: 'ne',
      value: 'x@y',
    });
    expect(parseScimFilter('userName sw "alice"')).toEqual({
      attribute: 'userName',
      op: 'sw',
      value: 'alice',
    });
    expect(parseScimFilter('userName ew "@example.com"')).toEqual({
      attribute: 'userName',
      op: 'ew',
      value: '@example.com',
    });
    expect(parseScimFilter('userName co "smith"')).toEqual({
      attribute: 'userName',
      op: 'co',
      value: 'smith',
    });
  });

  it('parses presence: `userName pr` (no value)', () => {
    expect(parseScimFilter('userName pr')).toEqual({
      attribute: 'userName',
      op: 'pr',
    });
  });

  it('returns null for unsupported filters', () => {
    expect(parseScimFilter('active eq true')).toBeNull();
    expect(parseScimFilter('userName gt "a"')).toBeNull(); // gt not supported
    expect(parseScimFilter('userName eq "a" and active eq true')).toBeNull(); // no compound
    expect(parseScimFilter('name.givenName eq "John"')).toBeNull(); // nested attrs
    expect(parseScimFilter('garbage')).toBeNull();
  });
});

// ─── Groups (B3-PR2) ──────────────────────────────────────────────────────

describe('roleToGroupId / groupIdToRole', () => {
  it('produces stable id format', () => {
    expect(roleToGroupId(UserRole.OWNER)).toBe('role:OWNER');
    expect(roleToGroupId(UserRole.VIEWER)).toBe('role:VIEWER');
  });

  it('round-trips every UserRole', () => {
    for (const r of SCIM_GROUP_ROLES) {
      expect(groupIdToRole(roleToGroupId(r))).toBe(r);
    }
  });

  it('returns null for unknown ids', () => {
    expect(groupIdToRole('role:WIZARD')).toBeNull();
    expect(groupIdToRole('owner')).toBeNull();
    expect(groupIdToRole('')).toBeNull();
  });

  it('exposes VIEWER as the removal fallback role', () => {
    expect(GROUP_REMOVAL_FALLBACK_ROLE).toBe(UserRole.VIEWER);
  });
});

describe('roleToScimGroup', () => {
  it('emits the SCIM Group schema and meta envelope', () => {
    const g = roleToScimGroup(UserRole.ADMIN, [
      { id: 'u1', fullName: 'Alice A', email: 'a@x.com' },
    ]);
    expect(g.schemas).toEqual([SCIM_GROUP_SCHEMA_URN]);
    expect(g.id).toBe('role:ADMIN');
    expect(g.displayName).toBe('ADMIN');
    expect(g.meta.resourceType).toBe('Group');
    expect(g.meta.location).toBe('/scim/v2/Groups/role:ADMIN');
    expect(g.members).toEqual([
      {
        value: 'u1',
        display: 'Alice A',
        $ref: '/scim/v2/Users/u1',
        type: 'User',
      },
    ]);
  });

  it('falls back to email when fullName is empty', () => {
    const g = roleToScimGroup(UserRole.VIEWER, [
      { id: 'u1', fullName: '', email: 'no-name@x.com' },
    ]);
    expect(g.members[0]!.display).toBe('no-name@x.com');
  });

  it('emits empty members array when no users hold the role', () => {
    const g = roleToScimGroup(UserRole.OWNER, []);
    expect(g.members).toEqual([]);
  });
});

describe('parseGroupPatchOps', () => {
  it('parses `add members [{value:id}]`', () => {
    expect(
      parseGroupPatchOps([{ op: 'add', path: 'members', value: [{ value: 'u1' }] }]),
    ).toEqual([{ action: 'add', userId: 'u1' }]);
  });

  it('parses `remove members [{value:id}]`', () => {
    expect(
      parseGroupPatchOps([
        { op: 'remove', path: 'members', value: [{ value: 'u1' }, { value: 'u2' }] },
      ]),
    ).toEqual([
      { action: 'remove', userId: 'u1' },
      { action: 'remove', userId: 'u2' },
    ]);
  });

  it('parses Okta legacy `remove members[value eq "id"]`', () => {
    expect(
      parseGroupPatchOps([{ op: 'remove', path: 'members[value eq "u1"]' }]),
    ).toEqual([{ action: 'remove', userId: 'u1' }]);
  });

  it('throws on unsupported op (replace)', () => {
    expect(() =>
      parseGroupPatchOps([{ op: 'replace', path: 'members', value: [] }]),
    ).toThrowError(/UNSUPPORTED_OP/);
  });

  it('throws on path other than `members`', () => {
    expect(() =>
      parseGroupPatchOps([{ op: 'add', path: 'displayName', value: [{ value: 'u1' }] }]),
    ).toThrowError(/UNSUPPORTED_OP/);
  });

  it('throws on malformed value (not an array)', () => {
    expect(() =>
      parseGroupPatchOps([{ op: 'add', path: 'members', value: 'u1' }]),
    ).toThrowError(/UNSUPPORTED_OP/);
  });
});

describe('diffGroupMembers', () => {
  it('classifies adds and removes', () => {
    expect(diffGroupMembers(['a', 'b'], ['b', 'c'])).toEqual({
      toAdd: ['c'],
      toRemove: ['a'],
    });
  });

  it('returns empty when current == desired', () => {
    expect(diffGroupMembers(['a', 'b'], ['b', 'a'])).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });

  it('returns full add when current is empty', () => {
    expect(diffGroupMembers([], ['a', 'b'])).toEqual({
      toAdd: ['a', 'b'],
      toRemove: [],
    });
  });

  it('returns full remove when desired is empty', () => {
    expect(diffGroupMembers(['a', 'b'], [])).toEqual({
      toAdd: [],
      toRemove: ['a', 'b'],
    });
  });
});
