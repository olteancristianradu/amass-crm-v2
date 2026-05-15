import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import type { Counter, Histogram } from 'prom-client';
import { BusinessMetricsService } from './business-metrics.service';

/**
 * BusinessMetricsService is a thin facade over prom-client Counter/Histogram
 * objects. We mock each metric at the @InjectMetric token via the package's
 * own `getToken(name)` helper so the real prom-client registry never gets
 * touched (which would leak global state across the test process).
 *
 * Coverage target: 100% lines — five methods, each exercised once, plus the
 * boolean branch in recordAuthLogin (success=true vs false).
 */

type LabelChain = { observe: ReturnType<typeof vi.fn>; inc: ReturnType<typeof vi.fn> };
function makeMetric(): { metric: { labels: ReturnType<typeof vi.fn> }; chain: LabelChain } {
  const chain: LabelChain = { observe: vi.fn(), inc: vi.fn() };
  const metric = { labels: vi.fn(() => chain) };
  return { metric, chain };
}

async function build(): Promise<{
  svc: BusinessMetricsService;
  httpDuration: { metric: { labels: ReturnType<typeof vi.fn> }; chain: LabelChain };
  dealStatus: { metric: { labels: ReturnType<typeof vi.fn> }; chain: LabelChain };
  invoiceStatus: { metric: { labels: ReturnType<typeof vi.fn> }; chain: LabelChain };
  callCompleted: { metric: { labels: ReturnType<typeof vi.fn> }; chain: LabelChain };
  authLogin: { metric: { labels: ReturnType<typeof vi.fn> }; chain: LabelChain };
}> {
  const httpDuration = makeMetric();
  const dealStatus = makeMetric();
  const invoiceStatus = makeMetric();
  const callCompleted = makeMetric();
  const authLogin = makeMetric();
  const moduleRef = await Test.createTestingModule({
    providers: [
      BusinessMetricsService,
      { provide: getToken('http_request_duration_seconds'), useValue: httpDuration.metric as unknown as Histogram<string> },
      { provide: getToken('deal_status_changed_total'), useValue: dealStatus.metric as unknown as Counter<string> },
      { provide: getToken('invoice_status_total'), useValue: invoiceStatus.metric as unknown as Counter<string> },
      { provide: getToken('call_completed_total'), useValue: callCompleted.metric as unknown as Counter<string> },
      { provide: getToken('auth_login_total'), useValue: authLogin.metric as unknown as Counter<string> },
    ],
  }).compile();
  const svc = moduleRef.get(BusinessMetricsService);
  return { svc, httpDuration, dealStatus, invoiceStatus, callCompleted, authLogin };
}

describe('BusinessMetricsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('observeHttpRequest calls labels(method, route, status) then observe(duration)', async () => {
    const h = await build();
    h.svc.observeHttpRequest('GET', '/api/v1/deals/:id', 200, 0.123);
    expect(h.httpDuration.metric.labels).toHaveBeenCalledWith('GET', '/api/v1/deals/:id', '200');
    expect(h.httpDuration.chain.observe).toHaveBeenCalledWith(0.123);
  });

  it('recordDealStatusChange increments deal_status_changed_total with from/to labels', async () => {
    const h = await build();
    h.svc.recordDealStatusChange('tenant-1', 'OPEN', 'WON');
    expect(h.dealStatus.metric.labels).toHaveBeenCalledWith('tenant-1', 'OPEN', 'WON');
    expect(h.dealStatus.chain.inc).toHaveBeenCalledTimes(1);
  });

  it('recordInvoiceStatus increments invoice_status_total with status label', async () => {
    const h = await build();
    h.svc.recordInvoiceStatus('tenant-2', 'PAID');
    expect(h.invoiceStatus.metric.labels).toHaveBeenCalledWith('tenant-2', 'PAID');
    expect(h.invoiceStatus.chain.inc).toHaveBeenCalledTimes(1);
  });

  it('recordCallCompleted increments call_completed_total with direction + outcome', async () => {
    const h = await build();
    h.svc.recordCallCompleted('tenant-3', 'INBOUND', 'answered');
    expect(h.callCompleted.metric.labels).toHaveBeenCalledWith('tenant-3', 'INBOUND', 'answered');
    expect(h.callCompleted.chain.inc).toHaveBeenCalledTimes(1);
  });

  it('recordAuthLogin maps success=true → "success"', async () => {
    const h = await build();
    h.svc.recordAuthLogin('tenant-4', true);
    expect(h.authLogin.metric.labels).toHaveBeenCalledWith('tenant-4', 'success');
    expect(h.authLogin.chain.inc).toHaveBeenCalledTimes(1);
  });

  it('recordAuthLogin maps success=false → "failure"', async () => {
    const h = await build();
    h.svc.recordAuthLogin('tenant-4', false);
    expect(h.authLogin.metric.labels).toHaveBeenCalledWith('tenant-4', 'failure');
  });
});
