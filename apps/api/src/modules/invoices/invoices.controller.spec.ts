import { describe, expect, it, vi } from 'vitest';
import { InvoicesController } from './invoices.controller';
import type { InvoicesService } from './invoices.service';

/**
 * Invoices controller is a thin pass-through to InvoicesService after
 * JWT/RBAC/Cedar guards. These specs pin DTO-to-arg mapping; the FSM,
 * tax math and PDF generation live in the service spec.
 */

function makeSvc() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    changeStatus: vi.fn(),
    getPdfUrl: vi.fn(),
    remove: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new InvoicesController(s as unknown as InvoicesService);
}

describe('InvoicesController', () => {
  it('POST → InvoicesService.create with DTO', async () => {
    const svc = makeSvc();
    svc.create.mockResolvedValue({ id: 'inv-1', status: 'DRAFT' });
    const ctrl = build(svc);

    const dto = {
      companyId: 'co-1',
      currency: 'RON',
      lines: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: 19 }],
    };
    await ctrl.create(dto as never);
    expect(svc.create).toHaveBeenCalledWith(dto);
  });

  it('GET → InvoicesService.list with query filters', async () => {
    const svc = makeSvc();
    svc.list.mockResolvedValue({ data: [], nextCursor: null });
    const ctrl = build(svc);

    const q = { status: 'SENT', limit: 25 };
    await ctrl.list(q as never);
    expect(svc.list).toHaveBeenCalledWith(q);
  });

  it('GET :id → InvoicesService.findOne', async () => {
    const svc = makeSvc();
    svc.findOne.mockResolvedValue({ id: 'inv-1' });
    const ctrl = build(svc);

    await ctrl.findOne('inv-1');
    expect(svc.findOne).toHaveBeenCalledWith('inv-1');
  });

  it('PATCH :id → InvoicesService.update with id + DTO', async () => {
    const svc = makeSvc();
    svc.update.mockResolvedValue({ id: 'inv-1' });
    const ctrl = build(svc);

    const dto = { notes: 'Plătit la timp' };
    await ctrl.update('inv-1', dto as never);
    expect(svc.update).toHaveBeenCalledWith('inv-1', dto);
  });

  it('POST :id/status → InvoicesService.changeStatus with id + DTO', async () => {
    const svc = makeSvc();
    svc.changeStatus.mockResolvedValue({ id: 'inv-1', status: 'SENT' });
    const ctrl = build(svc);

    const dto = { status: 'SENT' };
    await ctrl.changeStatus('inv-1', dto as never);
    expect(svc.changeStatus).toHaveBeenCalledWith('inv-1', dto);
  });

  it('GET :id/pdf-url → InvoicesService.getPdfUrl returns presigned URL', async () => {
    const svc = makeSvc();
    svc.getPdfUrl.mockResolvedValue({ url: 'https://minio/invoices/inv-1.pdf?sig=...' });
    const ctrl = build(svc);

    const r = await ctrl.pdfUrl('inv-1');
    expect(svc.getPdfUrl).toHaveBeenCalledWith('inv-1');
    expect(r.url).toContain('inv-1.pdf');
  });

  it('DELETE :id → InvoicesService.remove (DRAFT/CANCELLED only — enforced in service)', async () => {
    const svc = makeSvc();
    svc.remove.mockResolvedValue(undefined);
    const ctrl = build(svc);

    await ctrl.remove('inv-1');
    expect(svc.remove).toHaveBeenCalledWith('inv-1');
  });
});
