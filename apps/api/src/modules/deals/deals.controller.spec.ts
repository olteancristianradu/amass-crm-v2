import { describe, expect, it, vi } from 'vitest';
import { DealsController } from './deals.controller';
import type { DealsService } from './deals.service';

/**
 * Deals controller is a thin pass-through to DealsService after JWT/RBAC/
 * Cedar guards (covered by integration tests). These specs pin the
 * field mapping so a future refactor of DTO shapes is caught here.
 */

function makeSvc() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    forecast: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new DealsController(s as unknown as DealsService);
}

describe('DealsController', () => {
  it('POST → DealsService.create with DTO', async () => {
    const svc = makeSvc();
    svc.create.mockResolvedValue({ id: 'd1' });
    const ctrl = build(svc);

    const dto = { name: 'Deal X', pipelineId: 'p1', stageId: 's1', amount: 1000, currency: 'RON' };
    const r = await ctrl.create(dto as never);
    expect(svc.create).toHaveBeenCalledWith(dto);
    expect(r).toEqual({ id: 'd1' });
  });

  it('GET → DealsService.list with query filters', async () => {
    const svc = makeSvc();
    svc.list.mockResolvedValue({ data: [], nextCursor: null });
    const ctrl = build(svc);

    const q = { pipelineId: 'p1', limit: 50 };
    await ctrl.list(q as never);
    expect(svc.list).toHaveBeenCalledWith(q);
  });

  it('GET /forecast → DealsService.forecast with optional pipelineId', async () => {
    const svc = makeSvc();
    svc.forecast.mockResolvedValue({ committed: 0, bestCase: 0, weighted: 0 });
    const ctrl = build(svc);

    await ctrl.forecast('p1');
    expect(svc.forecast).toHaveBeenCalledWith('p1');

    await ctrl.forecast(undefined);
    expect(svc.forecast).toHaveBeenCalledWith(undefined);
  });

  it('GET :id → DealsService.findOne', async () => {
    const svc = makeSvc();
    svc.findOne.mockResolvedValue({ id: 'd1' });
    const ctrl = build(svc);

    await ctrl.findOne('d1');
    expect(svc.findOne).toHaveBeenCalledWith('d1');
  });

  it('PATCH :id → DealsService.update with id + DTO', async () => {
    const svc = makeSvc();
    svc.update.mockResolvedValue({ id: 'd1', name: 'Renamed' });
    const ctrl = build(svc);

    const dto = { name: 'Renamed' };
    await ctrl.update('d1', dto as never);
    expect(svc.update).toHaveBeenCalledWith('d1', dto);
  });

  it('POST :id/move → DealsService.move with id + MoveDealDto', async () => {
    const svc = makeSvc();
    svc.move.mockResolvedValue({ id: 'd1', stageId: 's2' });
    const ctrl = build(svc);

    const dto = { stageId: 's2', position: 0 };
    await ctrl.move('d1', dto as never);
    expect(svc.move).toHaveBeenCalledWith('d1', dto);
  });

  it('DELETE :id → DealsService.remove', async () => {
    const svc = makeSvc();
    svc.remove.mockResolvedValue(undefined);
    const ctrl = build(svc);

    await ctrl.remove('d1');
    expect(svc.remove).toHaveBeenCalledWith('d1');
  });
});
