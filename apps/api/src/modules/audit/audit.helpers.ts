/**
 * Pure helpers for AuditService — everything that doesn't need Prisma.
 *
 * Extracted so the tests stay fast (no Prisma client, no NestJS DI) and the
 * business rules (retention cutoff, SIEM payload shape, action whitelist)
 * remain easy to reason about in isolation.
 */
import type { AuditLog } from '@prisma/client';

/**
 * Compute the `createdAt < cutoff` boundary for a retention window.
 * Returns `null` when the window is non-positive (caller should no-op).
 */
export function computeRetentionCutoff(retentionDays: number, now: Date = new Date()): Date | null {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return null;
  return new Date(now.getTime() - retentionDays * 86_400_000);
}

/**
 * SIEM webhook payload — matches the shape downstream collectors expect
 * (elastic, splunk, datadog all accept this). Keep this stable across
 * versions; it's a public contract.
 */
export interface SiemPayload {
  tenantId: string;
  id: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  actorId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export function buildSiemPayload(tenantId: string, row: AuditLog): SiemPayload {
  return {
    tenantId,
    id: row.id,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    actorId: row.actorId,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Pagination slice for cursor-based list — takes `limit+1` rows from the
 * store, returns (data, nextCursor). Null cursor means we're at the end.
 */
export function sliceCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;
  return { data, nextCursor };
}
