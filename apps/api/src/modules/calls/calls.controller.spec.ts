import { describe, expect, it, vi } from 'vitest';
import { CallsController } from './calls.controller';
import type { CallsService } from './calls.service';

/**
 * Authenticated calls surface — initiate (click-to-call), list, findOne.
 * Thin pass-through to CallsService after Jwt/Roles/Cedar guards (covered
 * by integration tests).
 */

function makeSvc() {
  return {
    initiateCall: vi.fn(),
    list: vi.fn(),
    findOne: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new CallsController(s as unknown as CallsService);
}

describe('CallsController', () => {
  it('POST initiate → CallsService.initiateCall with DTO', async () => {
    const svc = makeSvc();
    svc.initiateCall.mockResolvedValue({ callSid: 'CA-x', dbId: 'call-1' });
    const ctrl = build(svc);

    const dto = { subjectType: 'CONTACT', subjectId: 'contact-1', toNumber: '+40700' };
    const r = await ctrl.initiateCall(dto as never);
    expect(svc.initiateCall).toHaveBeenCalledWith(dto);
    expect(r).toEqual({ callSid: 'CA-x', dbId: 'call-1' });
  });

  it('GET list → CallsService.list with query filters', async () => {
    const svc = makeSvc();
    svc.list.mockResolvedValue({ data: [], nextCursor: null });
    const ctrl = build(svc);

    const q = { subjectType: 'COMPANY', subjectId: 'co-1', limit: 25 };
    await ctrl.list(q as never);
    expect(svc.list).toHaveBeenCalledWith(q);
  });

  it('GET :id → CallsService.findOne with id', async () => {
    const svc = makeSvc();
    svc.findOne.mockResolvedValue({ id: 'call-1', status: 'COMPLETED' });
    const ctrl = build(svc);

    const r = await ctrl.findOne('call-1');
    expect(svc.findOne).toHaveBeenCalledWith('call-1');
    expect(r).toEqual({ id: 'call-1', status: 'COMPLETED' });
  });
});
