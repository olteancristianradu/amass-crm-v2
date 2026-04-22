import { describe, expect, it } from 'vitest';
import {
  ANON,
  ANON_EMAIL,
  buildClientAnonymisationPatch,
  buildContactAnonymisationPatch,
  CLIENT_PII_FIELDS,
  CONTACT_PII_FIELDS,
} from './gdpr.service';

describe('GDPR anonymisation helpers', () => {
  const fixedNow = new Date('2026-04-22T12:00:00Z');

  it('contact patch redacts every name/email field + clears phone/notes + stamps deletedAt', () => {
    const patch = buildContactAnonymisationPatch(fixedNow);
    expect(patch).toEqual({
      firstName: ANON,
      lastName: ANON,
      email: ANON_EMAIL,
      phone: null,
      mobile: null,
      notes: null,
      jobTitle: null,
      deletedAt: fixedNow,
    });
  });

  it('client patch matches the CLIENT_PII_FIELDS list + stamps deletedAt', () => {
    const patch = buildClientAnonymisationPatch(fixedNow);
    for (const field of CLIENT_PII_FIELDS) {
      expect(patch).toHaveProperty(field);
    }
    expect(patch.deletedAt).toEqual(fixedNow);
  });

  it('every CONTACT_PII_FIELD is covered by the contact patch (guards against schema drift)', () => {
    const patch = buildContactAnonymisationPatch();
    for (const field of CONTACT_PII_FIELDS) {
      expect(patch).toHaveProperty(field);
    }
  });

  it('ANON constants match the GDPR-compliant placeholders', () => {
    expect(ANON).toBe('[ANONYMISED]');
    expect(ANON_EMAIL).toBe('anonymised@deleted.invalid');
  });
});
