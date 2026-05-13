import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().min(18),
  role: z.enum(['OWNER', 'ADMIN', 'AGENT']),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value on a valid input', () => {
    const out = pipe.transform({ email: 'a@b.ro', age: 30, role: 'AGENT' });
    expect(out).toEqual({ email: 'a@b.ro', age: 30, role: 'AGENT' });
  });

  it('throws BadRequestException on a missing required field', () => {
    expect(() => pipe.transform({ email: 'a@b.ro', age: 30 })).toThrow(
      BadRequestException,
    );
  });

  it('error body has VALIDATION_ERROR code and a generic message (no leaked details)', () => {
    try {
      pipe.transform({ email: 'not-an-email', age: 15, role: 'AGENT' });
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const body = (err as BadRequestException).getResponse() as {
        code: string;
        message: string;
        details: { path: string; code: string }[];
      };
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Invalid request body');
      expect(Array.isArray(body.details)).toBe(true);
    }
  });

  it('details list contains only path + code — never raw values or full Zod tree', () => {
    try {
      pipe.transform({ email: 'not-an-email', age: 15, role: 'OWNER' });
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        details: { path: string; code: string }[];
      };
      // Two issues expected: email format + age min.
      expect(body.details.length).toBeGreaterThanOrEqual(2);
      // Verify each detail has ONLY {path, code} — no `expected`, no `received`,
      // no `options` list (which would leak enum values to a fuzzer).
      for (const d of body.details) {
        expect(Object.keys(d).sort()).toEqual(['code', 'path']);
      }
    }
  });

  it('rejects an entirely wrong shape (string instead of object)', () => {
    expect(() => pipe.transform('not-an-object')).toThrow(BadRequestException);
  });

  it('rejects enum mismatch without exposing the allowed values', () => {
    try {
      pipe.transform({ email: 'a@b.ro', age: 30, role: 'HACKER' });
    } catch (err) {
      const body = (err as BadRequestException).getResponse() as {
        details: { path: string; code: string }[];
      };
      const roleIssue = body.details.find((d) => d.path === 'role');
      expect(roleIssue).toBeDefined();
      // Critically: no 'options' / 'expected' / 'received' fields in the detail.
      expect(Object.keys(roleIssue!).sort()).toEqual(['code', 'path']);
    }
  });
});
