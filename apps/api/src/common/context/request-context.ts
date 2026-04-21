import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * M-2 — per-request trace context.
 *
 * Holds a single `requestId` (UUID) that follows a request from the edge
 * through every async boundary: controller → service → Prisma → BullMQ
 * enqueue → job data → worker → AI-worker HTTP call.
 *
 * Wired in RequestContextMiddleware (runs before tenant middleware). Downstream
 * code calls `getRequestId()` to include the id in job payloads or outbound
 * headers (e.g. X-Request-Id to the Python AI worker).
 *
 * Why not full OpenTelemetry yet? The CRM runs on a single node.js process
 * + a single Python worker + a single worker container. Full OTel machinery
 * (collector, exporter, propagator) is overkill and pulls ~15 MB of deps.
 * This homegrown context covers the 80 % of debugging value (a log filter
 * by `requestId` stitches the whole flow together). A future switch to
 * OTel can populate the same ALS slot.
 */
export interface RequestContext {
  requestId: string;
}

export const requestStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestStorage.getStore();
}

export function getRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

/** Generate a new requestId (UUID v4). */
export function newRequestId(): string {
  return randomUUID();
}

/** Run a function with the given requestId in ALS. Used by BullMQ workers. */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestStorage.run({ requestId }, fn);
}
