import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ContractAuditActorType,
  ContractAuditEntry,
  ContractAuditEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../../infra/prisma/tenant-context';

/**
 * Phase 2 F1 — append-only hash-chained audit trail (T-ESIGN-R-01).
 *
 * Each ContractAuditEntry row carries:
 *   prevEntryHash  — sha256 of the prior entry for the SAME contract,
 *                    NULL for the genesis entry.
 *   entryHash      — sha256( prevEntryHash || eventType || actorId
 *                            || createdAtISO || canonical(payload) )
 *
 * Verification: a nightly scheduler (Phase 2.5) walks each tenant's
 * contracts in order and re-derives the hashes. Any mismatch is a tamper
 * incident.
 *
 * Database guarantees (migration 20260518171000):
 *  - GRANT layer: app_user has only SELECT + INSERT on contract_audit_entries
 *  - Trigger layer: prevent_contract_audit_mutation aborts UPDATE/DELETE
 *    even if a future migration accidentally re-grants those rights.
 *
 * This service is the EXCLUSIVE write path. Direct prisma.contractAuditEntry
 * .create calls outside this file are a code-review smell — they bypass the
 * chain logic and create dangling entries that the verifier will reject.
 */
@Injectable()
export class AuditChainService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append a new entry. MUST run inside an existing transaction (tx) so the
   * chain commit shares atomicity with the business write that produced
   * the event (e.g. ContractSignature.update to SIGNED + audit entry).
   *
   * Returns the persisted row.
   */
  async append(
    tx: Prisma.TransactionClient,
    input: {
      contractId: string;
      signatureId?: string | null;
      eventType: ContractAuditEventType;
      actorType: ContractAuditActorType;
      actorId?: string | null;
      actorEmail?: string | null;
      actorIp?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<ContractAuditEntry> {
    const { tenantId } = requireTenantContext();

    // Locate the prior entry's hash. We could keep a denormalised "latest
    // hash per contract" on the Contract row to avoid the lookup, but the
    // index is tight (tenant_id, contract_id, created_at) and contracts
    // typically have <50 audit entries — the query is cheap.
    const prev = await tx.contractAuditEntry.findFirst({
      where: { tenantId, contractId: input.contractId },
      orderBy: { createdAt: 'desc' },
      select: { entryHash: true },
    });
    const prevEntryHash = prev?.entryHash ?? null;

    const payload = input.payload ?? {};
    // Server-generated createdAt — we DON'T trust client clocks. NB: the
    // resulting Date may differ by milliseconds from Prisma's @default(now())
    // because we pass the exact value at insert time; both layers must agree.
    const createdAt = new Date();

    const entryHash = this.computeHash({
      prevEntryHash,
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      createdAtIso: createdAt.toISOString(),
      payload,
    });

    return tx.contractAuditEntry.create({
      data: {
        tenantId,
        contractId: input.contractId,
        signatureId: input.signatureId ?? null,
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        actorIp: input.actorIp ?? null,
        payload: payload as Prisma.InputJsonValue,
        entryHash,
        prevEntryHash,
        createdAt,
      },
    });
  }

  /**
   * Re-derive entryHash from the canonical encoding. Public so the
   * verifier scheduler can call into the same logic — code reuse is the
   * point.
   *
   * Canonical encoding rules:
   *   - Field order is fixed: prev || type || actor || ts || payload.
   *   - Payload is JSON-stringified with sorted keys (deterministic).
   *   - Null fields are encoded as the literal string "null".
   * Any change to this function is a compatibility break — the verifier
   * cannot validate old chains under the new rules, so a one-time
   * re-derivation migration is mandatory.
   */
  computeHash(input: {
    prevEntryHash: string | null;
    eventType: ContractAuditEventType;
    actorId: string | null;
    createdAtIso: string;
    payload: Record<string, unknown>;
  }): string {
    const canonical = [
      input.prevEntryHash ?? 'null',
      input.eventType,
      input.actorId ?? 'null',
      input.createdAtIso,
      this.canonicalJson(input.payload),
    ].join('|');
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Deterministic JSON stringify with sorted keys at every nesting level.
   * Prisma JSONB columns preserve key order on roundtrip in current
   * versions, but we do not want to depend on that — sorting here is the
   * portable answer.
   */
  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => this.canonicalJson(v)).join(',')}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${this.canonicalJson(obj[k])}`).join(',')}}`;
  }

  /**
   * Walk the chain for one contract and verify each entry's hash matches
   * its computed value. Returns the first mismatched entry id, or null if
   * the chain is intact.
   *
   * Used by the nightly verifier (Phase 2.5 scheduler) and by tests.
   */
  async verifyContractChain(
    tenantId: string,
    contractId: string,
  ): Promise<{ ok: true } | { ok: false; firstBadEntryId: string }> {
    const entries = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contractAuditEntry.findMany({
        where: { tenantId, contractId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          entryHash: true,
          prevEntryHash: true,
          eventType: true,
          actorId: true,
          createdAt: true,
          payload: true,
        },
      }),
    );

    let expectedPrev: string | null = null;
    for (const e of entries) {
      if (e.prevEntryHash !== expectedPrev) {
        return { ok: false, firstBadEntryId: e.id };
      }
      const recomputed = this.computeHash({
        prevEntryHash: e.prevEntryHash,
        eventType: e.eventType,
        actorId: e.actorId,
        createdAtIso: e.createdAt.toISOString(),
        payload: (e.payload ?? {}) as Record<string, unknown>,
      });
      if (recomputed !== e.entryHash) {
        return { ok: false, firstBadEntryId: e.id };
      }
      expectedPrev = e.entryHash;
    }
    return { ok: true };
  }
}
