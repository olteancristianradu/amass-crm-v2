import { describe, expect, it, vi } from 'vitest';
import { PhoneNumbersController } from './phone-numbers.controller';
import type { PhoneNumbersService } from './phone-numbers.service';

/**
 * Phone-number CRUD passthrough. Numbers come from Twilio; this controller
 * just persists which of our users owns which number for click-to-call
 * routing.
 */

function makeSvc() {
  return {
    create: vi.fn(),
    list: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new PhoneNumbersController(s as unknown as PhoneNumbersService);
}

describe('PhoneNumbersController', () => {
  it('POST → PhoneNumbersService.create with DTO', async () => {
    const svc = makeSvc();
    svc.create.mockResolvedValue({ id: 'pn-1', e164: '+40700' });
    const ctrl = build(svc);

    const dto = { e164: '+40700', label: 'Suport', userId: null };
    const r = await ctrl.create(dto as never);
    expect(svc.create).toHaveBeenCalledWith(dto);
    expect(r).toEqual({ id: 'pn-1', e164: '+40700' });
  });

  it('GET → PhoneNumbersService.list', async () => {
    const svc = makeSvc();
    svc.list.mockResolvedValue([{ id: 'pn-1' }, { id: 'pn-2' }]);
    const ctrl = build(svc);

    const r = await ctrl.list();
    expect(svc.list).toHaveBeenCalledOnce();
    expect(r).toHaveLength(2);
  });

  it('GET :id → PhoneNumbersService.findOne', async () => {
    const svc = makeSvc();
    svc.findOne.mockResolvedValue({ id: 'pn-1' });
    const ctrl = build(svc);

    await ctrl.findOne('pn-1');
    expect(svc.findOne).toHaveBeenCalledWith('pn-1');
  });

  it('PATCH :id → PhoneNumbersService.update with id + partial DTO', async () => {
    const svc = makeSvc();
    svc.update.mockResolvedValue({ id: 'pn-1', label: 'New label' });
    const ctrl = build(svc);

    const dto = { label: 'New label' };
    await ctrl.update('pn-1', dto);
    expect(svc.update).toHaveBeenCalledWith('pn-1', dto);
  });

  it('DELETE :id → PhoneNumbersService.remove', async () => {
    const svc = makeSvc();
    svc.remove.mockResolvedValue(undefined);
    const ctrl = build(svc);

    await ctrl.remove('pn-1');
    expect(svc.remove).toHaveBeenCalledWith('pn-1');
  });
});
