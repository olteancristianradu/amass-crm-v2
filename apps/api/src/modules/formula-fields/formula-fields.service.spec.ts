import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('./formula-evaluator', () => ({
  evaluateFormula: vi.fn(),
}));

import { FormulaFieldsService } from './formula-fields.service';
import { evaluateFormula } from './formula-evaluator';

function build() {
  const tx = {
    formulaField: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof FormulaFieldsService>[0];
  const svc = new FormulaFieldsService(prisma);
  return { svc, prisma, tx };
}

describe('FormulaFieldsService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an expression that fails to dry-run', async () => {
    const h = build();
    vi.mocked(evaluateFormula).mockImplementationOnce(() => {
      throw new Error('Unexpected token');
    });
    await expect(
      h.svc.create({
        entityType: 'COMPANY',
        fieldName: 'mrr',
        expression: '!!!',
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(h.tx.formulaField.create).not.toHaveBeenCalled();
  });

  it('persists with tenantId when expression is valid', async () => {
    const h = build();
    vi.mocked(evaluateFormula).mockReturnValueOnce(0 as never);
    h.tx.formulaField.create.mockResolvedValueOnce({ id: 'f-1' });
    await h.svc.create({
      entityType: 'COMPANY',
      fieldName: 'mrr',
      expression: 'value * 0.1',
    } as never);
    const data = h.tx.formulaField.create.mock.calls[0][0].data;
    expect(data.tenantId).toBe('tenant-1');
    expect(data.fieldName).toBe('mrr');
  });
});

describe('FormulaFieldsService.findAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies entityType filter when set', async () => {
    const h = build();
    h.tx.formulaField.findMany.mockResolvedValueOnce([]);
    await h.svc.findAll('CONTACT' as never);
    const where = h.tx.formulaField.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: 'tenant-1', entityType: 'CONTACT' });
  });
});

describe('FormulaFieldsService.findOne', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws FORMULA_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.formulaField.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('FormulaFieldsService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips dry-run when expression is not in the patch', async () => {
    const h = build();
    h.tx.formulaField.findFirst.mockResolvedValueOnce({ id: 'f-1' });
    h.tx.formulaField.update.mockResolvedValueOnce({ id: 'f-1' });
    await h.svc.update('f-1', { fieldName: 'renamed' } as never);
    expect(vi.mocked(evaluateFormula)).not.toHaveBeenCalled();
  });

  it('runs dry-run when expression IS in the patch', async () => {
    const h = build();
    vi.mocked(evaluateFormula).mockReturnValueOnce(0 as never);
    h.tx.formulaField.findFirst.mockResolvedValueOnce({ id: 'f-1' });
    h.tx.formulaField.update.mockResolvedValueOnce({ id: 'f-1' });
    await h.svc.update('f-1', { expression: 'value * 2' } as never);
    expect(vi.mocked(evaluateFormula)).toHaveBeenCalled();
  });
});

describe('FormulaFieldsService.remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hard-deletes after asserting existence', async () => {
    const h = build();
    h.tx.formulaField.findFirst.mockResolvedValueOnce({ id: 'f-1' });
    h.tx.formulaField.delete.mockResolvedValueOnce({ id: 'f-1' });
    await h.svc.remove('f-1');
    expect(h.tx.formulaField.delete).toHaveBeenCalledWith({ where: { id: 'f-1' } });
  });
});

describe('FormulaFieldsService.computeAll', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips inactive fields', async () => {
    const h = build();
    h.tx.formulaField.findMany.mockResolvedValueOnce([
      { fieldName: 'a', expression: 'x', isActive: true },
      { fieldName: 'b', expression: 'y', isActive: false },
    ]);
    vi.mocked(evaluateFormula).mockReturnValueOnce(42 as never);
    const out = await h.svc.computeAll('COMPANY' as never, { x: 1 });
    expect(out).toEqual({ a: 42 });
    expect(out.b).toBeUndefined();
  });

  it('captures per-field errors as #ERR string instead of failing the batch', async () => {
    const h = build();
    h.tx.formulaField.findMany.mockResolvedValueOnce([
      { fieldName: 'good', expression: 'x', isActive: true },
      { fieldName: 'bad', expression: '!!!', isActive: true },
    ]);
    vi.mocked(evaluateFormula)
      .mockReturnValueOnce(10 as never)
      .mockImplementationOnce(() => {
        throw new Error('parse error');
      });
    const out = await h.svc.computeAll('COMPANY' as never, {});
    expect(out.good).toBe(10);
    expect(out.bad).toContain('#ERR');
  });
});

describe('FormulaFieldsService.evaluate', () => {
  it('throws BadRequest on parse error', () => {
    const h = build();
    vi.mocked(evaluateFormula).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(() => h.svc.evaluate('!!!', {})).toThrow(BadRequestException);
  });

  it('returns the evaluator result on success', () => {
    const h = build();
    vi.mocked(evaluateFormula).mockReturnValueOnce(99 as never);
    expect(h.svc.evaluate('x + 1', { x: 98 })).toBe(99);
  });
});
