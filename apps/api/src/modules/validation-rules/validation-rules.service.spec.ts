import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ValidationRulesService } from './validation-rules.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

const rule = (overrides: Record<string, unknown>) =>
  ({
    id: 'r-1',
    isActive: true,
    field: 'name',
    errorMessage: 'Invalid',
    ...overrides,
  }) as any;

describe('ValidationRulesService.assertValid', () => {
  let svc: ValidationRulesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ValidationRulesService(mockPrisma);
  });

  const run = (rules: unknown[], payload: Record<string, unknown>) => {
    mockRunWithTenant.mockImplementation(async (_t, fn) =>
      fn({ validationRule: { findMany: vi.fn().mockResolvedValue(rules) } }),
    );
    return svc.assertValid('COMPANY' as any, payload);
  };

  it('passes when no rules exist', async () => {
    await expect(run([], { name: 'Acme' })).resolves.toBeUndefined();
  });

  it('skips inactive rules', async () => {
    await expect(
      run([rule({ isActive: false, operator: 'MIN_LENGTH', value: '100' })], { name: 'x' }),
    ).resolves.toBeUndefined();
  });

  it('throws BadRequest on REGEX mismatch', async () => {
    await expect(
      run([rule({ operator: 'REGEX', value: '^[A-Z]+$' })], { name: 'lower' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('passes on REGEX match', async () => {
    await expect(
      run([rule({ operator: 'REGEX', value: '^[A-Z]+$' })], { name: 'UPPER' }),
    ).resolves.toBeUndefined();
  });

  it('treats invalid stored regex as pass-through (no blocking writes)', async () => {
    await expect(
      run([rule({ operator: 'REGEX', value: '[invalid' })], { name: 'anything' }),
    ).resolves.toBeUndefined();
  });

  it('enforces MIN_LENGTH', async () => {
    await expect(
      run([rule({ operator: 'MIN_LENGTH', value: '5' })], { name: 'abc' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces MAX_LENGTH', async () => {
    await expect(
      run([rule({ operator: 'MAX_LENGTH', value: '3' })], { name: 'abcdef' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('enforces EQUALS', async () => {
    await expect(
      run([rule({ operator: 'EQUALS', value: 'Acme' })], { name: 'Other' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      run([rule({ operator: 'EQUALS', value: 'Acme' })], { name: 'Acme' }),
    ).resolves.toBeUndefined();
  });

  it('enforces NOT_EQUALS', async () => {
    await expect(
      run([rule({ operator: 'NOT_EQUALS', value: 'forbidden' })], { name: 'forbidden' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('treats missing field as empty string', async () => {
    // MIN_LENGTH 1 on missing field → fails because '' has length 0.
    await expect(
      run([rule({ operator: 'MIN_LENGTH', value: '1', field: 'missing' })], { name: 'x' }),
    ).rejects.toThrow(BadRequestException);
  });
});
