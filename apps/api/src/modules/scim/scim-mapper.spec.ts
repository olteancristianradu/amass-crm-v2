import { describe, expect, it } from 'vitest';
import type { User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { applyScimPatch, parseScimFilter, scimToUserCreateInput, userToScim } from './scim-mapper';
import { SCIM_USER_SCHEMA_URN } from './scim.dto';

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
      userName: 'alice@example.com',
    });
  });

  it('lowercases the matched value', () => {
    expect(parseScimFilter('userName eq "ALICE@EXAMPLE.COM"')).toEqual({
      userName: 'alice@example.com',
    });
  });

  it('returns null for unsupported filters', () => {
    expect(parseScimFilter('active eq true')).toBeNull();
    expect(parseScimFilter('userName sw "a"')).toBeNull();
    expect(parseScimFilter('garbage')).toBeNull();
  });
});
