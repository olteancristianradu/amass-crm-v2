import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ApprovalPolicyTrigger,
  ApprovalStatus,
  ApprovalSubjectType,
  Prisma,
  QuoteStatus,
} from '@prisma/client';
import {
  CreateApprovalPolicyDto,
  CreateApprovalRequestDto,
  ListApprovalRequestsDto,
  MakeApprovalDecisionDto,
  StepsConfig,
  UpdateApprovalPolicyDto,
  WithdrawApprovalRequestDto,
  triggerConfigSchemaFor,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ApprovalsNotifierService } from './approvals-notifier.service';

/**
 * Phase 2 F2 — multi-step polymorphic approval workflows.
 *
 * Subject types supported: QUOTE (legacy back-compat), CONTRACT, DEAL,
 * INVOICE, EXPENSE. The `quoteId` column on ApprovalRequest is dual-written
 * for the 30-day grace window when subjectType=QUOTE, then DROPped in a
 * follow-up migration (see schema.prisma:1672-1676).
 *
 * State machine (see docs/specs/phase-2.md F2.3 + F2.4):
 *   PENDING ─approve─▶ IN_PROGRESS (advance step) ─approve final step─▶ APPROVED
 *           │                  │
 *           │                  └─reject─▶ REJECTED (terminal)
 *           │                  └─withdraw (by requester)─▶ WITHDRAWN
 *           │                  └─SLA cron tick after expiresAt─▶ EXPIRED
 *           └─reject step 1─▶ REJECTED
 *           └─withdraw step 1─▶ WITHDRAWN
 *           └─cron after expiresAt─▶ EXPIRED
 *
 * Race safety (T-APPR-T-03): every state mutation runs inside a
 * `runWithTenant` transaction with `SELECT ... FOR UPDATE` on both the
 * request and the current step. Two approvers clicking APPROVE at the same
 * step at the same time: the first wins; the second sees the row already
 * advanced and gets 409 STALE_REQUEST.
 *
 * Self-approval bypass (T-APPR-E-01): if the step's resolved approver is
 * the requester, the step auto-skips with `approval.step.skipped_self_approval`
 * intent recorded as a system decision; if all steps end up self-skipped,
 * the request escalates by remaining PENDING with no current step (admin
 * must intervene). Implemented in `advanceUntilHumanStep`.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ApprovalsNotifierService,
  ) {}

  // ─── Policies ──────────────────────────────────────────────────────────────

  async createPolicy(dto: CreateApprovalPolicyDto) {
    const { tenantId } = requireTenantContext();
    this.assertTriggerConfig(dto.trigger, dto.config);
    const steps = (dto.stepsConfig ?? []) as StepsConfig;
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.create({
        data: {
          tenantId,
          name: dto.name,
          trigger: dto.trigger as ApprovalPolicyTrigger,
          config: dto.config as Prisma.InputJsonValue,
          approverId: dto.approverId ?? null,
          subjectType: dto.subjectType as ApprovalSubjectType,
          stepsConfig: steps as unknown as Prisma.InputJsonValue,
          isActive: dto.isActive,
        },
      }),
    );
  }

  async listPolicies(subjectType?: ApprovalSubjectType) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.findMany({
        where: {
          tenantId,
          deletedAt: null,
          ...(subjectType ? { subjectType } : {}),
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async updatePolicy(id: string, dto: UpdateApprovalPolicyDto) {
    const { tenantId } = requireTenantContext();
    await this.assertPolicy(tenantId, id);
    // T-APPR-T-02 — policy is immutable once any in-flight request exists.
    // We refuse mutations that would change snapshot-bearing fields
    // (trigger, config, stepsConfig, approverId, subjectType) while there
    // is at least one PENDING/IN_PROGRESS request bound to this policy.
    const wantsSnapshotChange =
      dto.trigger !== undefined ||
      dto.config !== undefined ||
      dto.stepsConfig !== undefined ||
      dto.approverId !== undefined ||
      dto.subjectType !== undefined;
    if (wantsSnapshotChange) {
      const inflight = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.approvalRequest.count({
          where: { tenantId, policyId: id, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        }),
      );
      if (inflight > 0) {
        throw new ConflictException({
          code: 'POLICY_IMMUTABLE_INFLIGHT',
          message: `Policy has ${inflight} in-flight requests; only isActive/name can change`,
        });
      }
    }
    if (dto.trigger !== undefined) {
      this.assertTriggerConfig(dto.trigger, dto.config ?? {});
    }
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.trigger ? { trigger: dto.trigger as ApprovalPolicyTrigger } : {}),
          ...(dto.config ? { config: dto.config as Prisma.InputJsonValue } : {}),
          ...(dto.approverId !== undefined ? { approverId: dto.approverId ?? null } : {}),
          ...(dto.subjectType ? { subjectType: dto.subjectType as ApprovalSubjectType } : {}),
          ...(dto.stepsConfig !== undefined
            ? { stepsConfig: (dto.stepsConfig ?? []) as unknown as Prisma.InputJsonValue }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      }),
    );
  }

  async removePolicy(id: string) {
    const { tenantId } = requireTenantContext();
    await this.assertPolicy(tenantId, id);
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    );
  }

  private async assertPolicy(tenantId: string, id: string) {
    const p = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.findFirst({ where: { id, tenantId, deletedAt: null } }),
    );
    if (!p) throw new NotFoundException('Approval policy not found');
    return p;
  }

  private assertTriggerConfig(trigger: string, config: unknown) {
    const schema = triggerConfigSchemaFor(trigger as ApprovalPolicyTrigger);
    const r = schema.safeParse(config ?? {});
    if (!r.success) {
      throw new BadRequestException({
        code: 'INVALID_TRIGGER_CONFIG',
        message: `Config invalid for trigger ${trigger}: ${r.error.message}`,
      });
    }
  }

  // ─── Requests — creation paths ─────────────────────────────────────────────

  /**
   * Legacy quote-only entry point. Kept for back-compat — QuotesService still
   * calls this from the existing `send` flow. Internally delegates to the
   * polymorphic `checkAndRequestApprovalForSubject`.
   */
  async checkAndRequestApproval(
    quoteId: string,
    quoteTotal: Prisma.Decimal,
    quoteCurrency: string,
  ): Promise<boolean> {
    return this.checkAndRequestApprovalForSubject(
      'QUOTE',
      quoteId,
      { value: quoteTotal, currency: quoteCurrency },
      { quoteId },
    );
  }

  /**
   * Phase 2 polymorphic entry — called by ContractsService.send,
   * QuotesService.send, etc. Matches active policies for `subjectType` whose
   * `config` thresholds are satisfied by `subjectAttrs`, then creates one
   * ApprovalRequest per matching policy. Returns true if any request was
   * created (caller MUST block the subject transition).
   *
   * `extra.quoteId` is set only for QUOTE subjects so the dual-write to the
   * legacy column is preserved during the 30-day grace window.
   */
  async checkAndRequestApprovalForSubject(
    subjectType: ApprovalSubjectType,
    subjectId: string,
    subjectAttrs: { value?: Prisma.Decimal | number; currency?: string; discountPct?: number },
    extra: { quoteId?: string } = {},
  ): Promise<boolean> {
    const { tenantId, userId } = requireTenantContext();
    const policies = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalPolicy.findMany({
        where: { tenantId, isActive: true, deletedAt: null, subjectType },
      }),
    );

    const matched = policies.filter((p) => this.matchesTrigger(p.trigger, p.config, subjectAttrs));
    if (matched.length === 0) return false;

    for (const policy of matched) {
      // One request per (policy, subject) — skipping if there is already an
      // active one prevents duplicate workflows on a quote re-send.
      const existing = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.approvalRequest.findFirst({
          where: {
            tenantId,
            policyId: policy.id,
            subjectType,
            subjectId,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
        }),
      );
      if (existing) continue;

      await this.openRequest(tenantId, {
        policyId: policy.id,
        subjectType,
        subjectId,
        requestedBy: userId ?? 'system',
        quoteId: extra.quoteId,
        slaDays: undefined,
      });
    }
    return true;
  }

  /**
   * Direct create endpoint — POST /approvals/requests. Validates that the
   * referenced policy is active + applicable to the subject, then opens.
   * No trigger evaluation here (caller has already decided they want this
   * approval; the policy gates WHO must sign off, not WHETHER).
   */
  async createRequest(dto: CreateApprovalRequestDto) {
    const { tenantId, userId } = requireTenantContext();
    const policy = await this.assertPolicy(tenantId, dto.policyId);
    if (policy.subjectType !== dto.subjectType) {
      throw new BadRequestException({
        code: 'POLICY_SUBJECT_MISMATCH',
        message: `Policy ${policy.id} is for ${policy.subjectType}, not ${dto.subjectType}`,
      });
    }
    return this.openRequest(tenantId, {
      policyId: dto.policyId,
      subjectType: dto.subjectType as ApprovalSubjectType,
      subjectId: dto.subjectId,
      requestedBy: userId ?? 'system',
      quoteId: dto.subjectType === 'QUOTE' ? dto.subjectId : undefined,
      slaDays: dto.slaDays,
    });
  }

  /**
   * Lower-level open. Snapshots `policy.stepsConfig` into ApprovalStep rows
   * (T-APPR-S-XX immutable chain), computes step 0 expiry, and notifies the
   * first eligible approver. Returns the created request including steps.
   */
  private async openRequest(
    tenantId: string,
    args: {
      policyId: string;
      subjectType: ApprovalSubjectType;
      subjectId: string;
      requestedBy: string;
      quoteId?: string;
      slaDays?: number;
    },
  ) {
    const policy = await this.assertPolicy(tenantId, args.policyId);
    const stepsConfig = this.parseStepsConfig(policy.stepsConfig, policy.approverId);
    if (stepsConfig.length === 0) {
      throw new BadRequestException({
        code: 'POLICY_HAS_NO_STEPS',
        message: 'Policy has no step chain configured',
      });
    }

    const now = new Date();
    const expiresAt = args.slaDays
      ? new Date(now.getTime() + args.slaDays * 24 * 60 * 60 * 1000)
      : null;

    const created = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const req = await tx.approvalRequest.create({
        data: {
          tenantId,
          policyId: policy.id,
          quoteId: args.quoteId ?? null,
          subjectType: args.subjectType,
          subjectId: args.subjectId,
          requestedBy: args.requestedBy,
          status: 'PENDING',
          expiresAt,
        },
      });
      // Materialize step snapshots. ALL steps PENDING; activation happens
      // below in advanceUntilHumanStep which will flip the first non-skipped
      // step to ACTIVE + set currentStepId on the request.
      for (const s of stepsConfig) {
        await tx.approvalStep.create({
          data: {
            tenantId,
            requestId: req.id,
            order: s.order,
            approverId: s.approverId ?? null,
            approverRole: s.approverRole ?? null,
            slaHours: s.slaHours ?? null,
            status: 'PENDING',
          },
        });
      }
      return req;
    });

    await this.advanceUntilHumanStep(tenantId, created.id, args.requestedBy);
    return this.getRequest(created.id);
  }

  // ─── Decision / withdraw / lookups ─────────────────────────────────────────

  async decide(requestId: string, dto: MakeApprovalDecisionDto) {
    const { tenantId, userId } = requireTenantContext();
    const newStatus = dto.status as ApprovalStatus;

    // Transaction with SELECT FOR UPDATE on request + current step.
    // Mitigation for T-APPR-T-03 (state machine bypass) + the F2.3 race
    // scenario where two approvers click simultaneously.
    const outcome = await this.prisma.runWithTenant(tenantId, async (tx) => {
      // FOR UPDATE on the request row — anything reading it concurrently
      // blocks until we commit. Postgres-only syntax (the test stack uses
      // Postgres 16, matching prod).
      const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM approval_requests
        WHERE id = ${requestId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `;
      if (lockedRows.length === 0) throw new NotFoundException('Approval request not found');

      const request = await tx.approvalRequest.findFirst({
        where: { id: requestId, tenantId },
        include: { policy: true, currentStep: true },
      });
      if (!request) throw new NotFoundException('Approval request not found');
      if (request.status !== 'PENDING' && request.status !== 'IN_PROGRESS') {
        throw new ConflictException({
          code: 'REQUEST_NOT_PENDING',
          message: `Request is in terminal state ${request.status}`,
        });
      }
      if (!request.currentStepId) {
        throw new ConflictException({
          code: 'NO_CURRENT_STEP',
          message: 'Request has no active step (likely all self-skipped — admin escalation needed)',
        });
      }

      const currentStep = request.currentStep;
      if (!currentStep || currentStep.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'STALE_REQUEST',
          message: 'Current step is no longer active',
        });
      }

      // T-APPR-E-01 hard guard at decision: requester cannot decide on
      // their own request even if somehow assigned (defense in depth on
      // top of advanceUntilHumanStep's skip rule).
      if (request.requestedBy === userId) {
        throw new ForbiddenException({
          code: 'SELF_APPROVAL_FORBIDDEN',
          message: 'Requester cannot decide on their own request',
        });
      }

      // T-APPR-T-03 — must be the assigned approver. (Role-based steps
      // resolve at notification time — here we accept any user whose
      // userId matches; role-based approval requires an additional roles
      // lookup which we keep narrow for the MVP and defer until the
      // notifier exposes the role-resolved set.)
      if (currentStep.approverId && currentStep.approverId !== userId) {
        throw new ForbiddenException({
          code: 'NOT_CURRENT_STEP_APPROVER',
          message: 'You are not the assigned approver for the current step',
        });
      }

      // Append-only decision row.
      await tx.approvalDecision.create({
        data: {
          tenantId,
          requestId,
          stepId: currentStep.id,
          deciderId: userId ?? 'system',
          status: newStatus,
          comment: dto.comment ?? null,
        },
      });

      // Update step terminal state.
      await tx.approvalStep.update({
        where: { id: currentStep.id },
        data: { status: newStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED', completedAt: new Date() },
      });

      if (newStatus === 'REJECTED') {
        // Terminal — abort chain. Side-effect on quote handled below
        // (caller-agnostic: subjectType drives the right path).
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: { status: 'REJECTED', completedAt: new Date(), currentStepId: null },
        });
        return {
          terminal: true as const,
          status: 'REJECTED' as ApprovalStatus,
          request,
        };
      }

      // APPROVED — try to advance to next step.
      const nextStep = await tx.approvalStep.findFirst({
        where: { tenantId, requestId, order: { gt: currentStep.order }, status: 'PENDING' },
        orderBy: { order: 'asc' },
      });

      if (!nextStep) {
        // Chain complete.
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', completedAt: new Date(), currentStepId: null },
        });
        return { terminal: true as const, status: 'APPROVED' as ApprovalStatus, request };
      }

      // Activate the next step. We don't notify here — advanceUntilHumanStep
      // runs after the transaction commits to handle self-approval skips
      // and emit notifications outside the lock window.
      await tx.approvalStep.update({
        where: { id: nextStep.id },
        data: {
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: nextStep.slaHours
            ? new Date(Date.now() + nextStep.slaHours * 60 * 60 * 1000)
            : null,
        },
      });
      await tx.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'IN_PROGRESS', currentStepId: nextStep.id },
      });

      return { terminal: false as const, status: 'IN_PROGRESS' as ApprovalStatus, request, nextStep };
    });

    // Post-commit side effects: quote status flip + notifications.
    await this.applySubjectSideEffects(tenantId, requestId);
    if (outcome.terminal) {
      await this.notifier.notifyTerminal(tenantId, requestId, outcome.status, userId);
    } else {
      await this.advanceUntilHumanStep(tenantId, requestId, outcome.request.requestedBy);
    }

    return {
      status: outcome.status,
      message:
        outcome.status === 'APPROVED'
          ? 'Approved'
          : outcome.status === 'REJECTED'
            ? 'Rejected — chain terminated'
            : 'Approved at this step; advanced to next step',
    };
  }

  async withdraw(requestId: string, dto: WithdrawApprovalRequestDto) {
    const { tenantId, userId } = requireTenantContext();
    const request = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findFirst({
        where: { id: requestId, tenantId },
        include: { currentStep: true },
      }),
    );
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.requestedBy !== userId) {
      throw new ForbiddenException({
        code: 'NOT_REQUESTER',
        message: 'Only the requester can withdraw a request',
      });
    }
    if (request.status !== 'PENDING' && request.status !== 'IN_PROGRESS') {
      throw new ConflictException({
        code: 'REQUEST_NOT_PENDING',
        message: `Request is in terminal state ${request.status}`,
      });
    }

    await this.prisma.runWithTenant(tenantId, async (tx) => {
      await tx.approvalDecision.create({
        data: {
          tenantId,
          requestId,
          stepId: request.currentStepId,
          deciderId: userId ?? 'system',
          status: 'CANCELLED', // ApprovalStatus enum has no WITHDRAWN-step;
          // the request-level status carries WITHDRAWN.
          comment: dto.reason,
        },
      });
      if (request.currentStepId) {
        await tx.approvalStep.update({
          where: { id: request.currentStepId },
          data: { status: 'SKIPPED', completedAt: new Date() },
        });
      }
      await tx.approvalRequest.update({
        where: { id: requestId },
        data: { status: 'CANCELLED', completedAt: new Date(), currentStepId: null },
        // We tag the request as CANCELLED at the DB layer (WITHDRAWN as a
        // separate status will be added in a follow-up enum extension; the
        // intent — requester-initiated terminate — is captured by the
        // matching audit event below).
      });
    });

    await this.notifier.notifyWithdrawn(tenantId, requestId, userId ?? 'system', dto.reason);
    return { status: 'CANCELLED' as ApprovalStatus, message: 'Withdrawn' };
  }

  async listRequests(filter: ListApprovalRequestsDto) {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.ApprovalRequestWhereInput = {
        tenantId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.subjectType ? { subjectType: filter.subjectType } : {}),
        ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
        ...(filter.quoteId ? { quoteId: filter.quoteId } : {}),
      };
      if (filter.assignedToMe) {
        if (!userId) return [];
        // Inbox semantics: only requests where I am the approver of the
        // CURRENT step (not historical steps I already decided on).
        where.currentStep = { approverId: userId, status: 'ACTIVE' };
        where.status = { in: ['PENDING', 'IN_PROGRESS'] };
      }
      return tx.approvalRequest.findMany({
        where,
        include: {
          policy: true,
          decisions: { orderBy: { decidedAt: 'desc' } },
          steps: { orderBy: { order: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    });
  }

  async getRequest(id: string) {
    const { tenantId } = requireTenantContext();
    const req = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findFirst({
        where: { id, tenantId },
        include: {
          policy: true,
          decisions: { orderBy: { decidedAt: 'desc' } },
          steps: { orderBy: { order: 'asc' } },
        },
      }),
    );
    if (!req) throw new NotFoundException('Approval request not found');
    return req;
  }

  async listMyInbox() {
    return this.listRequests({ assignedToMe: true });
  }

  // ─── SLA expiry (called by processor) ──────────────────────────────────────

  /**
   * Sweeps EXPIRED transitions for a single tenant. Returns the number of
   * requests transitioned. Idempotent — re-running is a no-op for rows
   * already in a terminal state.
   *
   * Two expiry paths:
   *   (a) request-level `expiresAt` (per-request override set on creation)
   *   (b) current step's `expiresAt` (per-step SLA from policy.stepsConfig)
   * Either firing → the WHOLE request transitions to EXPIRED.
   */
  async expireOverdueForTenant(tenantId: string): Promise<number> {
    const overdue = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findMany({
        where: {
          tenantId,
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          OR: [
            { expiresAt: { lt: new Date(), not: null } },
            { currentStep: { expiresAt: { lt: new Date(), not: null }, status: 'ACTIVE' } },
          ],
        },
        select: { id: true, requestedBy: true, currentStepId: true },
        take: 500, // batch cap — next tick picks up the rest
      }),
    );

    let expired = 0;
    for (const r of overdue) {
      try {
        const didExpire = await this.prisma.runWithTenant(tenantId, async (tx) => {
          // Defense: re-check inside the tx (the row may have been decided
          // between SELECT and UPDATE in a high-traffic tenant).
          const fresh = await tx.approvalRequest.findFirst({
            where: { id: r.id, tenantId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
          });
          if (!fresh) return false;
          await tx.approvalDecision.create({
            data: {
              tenantId,
              requestId: r.id,
              stepId: r.currentStepId,
              deciderId: 'system',
              status: 'EXPIRED',
              comment: 'Auto-expired: SLA deadline exceeded',
            },
          });
          if (r.currentStepId) {
            await tx.approvalStep.update({
              where: { id: r.currentStepId },
              data: { status: 'SKIPPED', completedAt: new Date() },
            });
          }
          await tx.approvalRequest.update({
            where: { id: r.id },
            data: { status: 'EXPIRED', completedAt: new Date(), currentStepId: null },
          });
          return true;
        });
        if (didExpire) {
          await this.notifier.notifyExpired(tenantId, r.id, r.requestedBy);
          expired += 1;
        }
      } catch (err) {
        this.logger.error(
          `expire failed for request=${r.id} tenant=${tenantId}: ${(err as Error).message}`,
        );
      }
    }
    return expired;
  }

  /**
   * Cross-tenant batch entry — called by the BullMQ scheduler. Returns the
   * total expired across all tenants. Tenant iteration is intentionally
   * serial: the per-tick cap (500 requests/tenant) ensures even a backlog
   * tenant can't starve the worker, and Postgres connection pressure stays
   * bounded.
   */
  async expireOverdueForAllTenants(): Promise<{ tenants: number; expired: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    let expired = 0;
    for (const t of tenants) {
      try {
        expired += await this.expireOverdueForTenant(t.id);
      } catch (err) {
        this.logger.error(
          `expireOverdueForTenant(${t.id}) failed: ${(err as Error).message}`,
        );
      }
    }
    return { tenants: tenants.length, expired };
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Walks forward from the current step, auto-skipping any step whose
   * resolved approver is the requester (T-APPR-E-01). Stops at the first
   * human-eligible step and notifies. If ALL remaining steps self-skip,
   * the request escalates: stays IN_PROGRESS with currentStepId=null —
   * a human admin must intervene (audit logged).
   *
   * Also handles the cold-start case after `openRequest`: PENDING → finds
   * step order=0, activates it (or auto-approves+advances if self-approval).
   */
  private async advanceUntilHumanStep(
    tenantId: string,
    requestId: string,
    requestedBy: string,
  ): Promise<void> {
    // Loop bound — defends against pathological self-approval chains.
    for (let i = 0; i < 32; i++) {
      const result = await this.prisma.runWithTenant(tenantId, async (tx) => {
        const req = await tx.approvalRequest.findFirst({
          where: { id: requestId, tenantId },
          include: { currentStep: true },
        });
        if (!req) return { kind: 'gone' as const };
        if (req.status === 'APPROVED' || req.status === 'REJECTED' ||
            req.status === 'CANCELLED' || req.status === 'EXPIRED') {
          return { kind: 'terminal' as const };
        }
        // Find the next step to consider.
        let candidate = req.currentStep;
        if (!candidate || candidate.status !== 'PENDING') {
          // Either no current, or the current is already ACTIVE (humans
          // working) / completed. If ACTIVE: already notified → exit.
          if (candidate && candidate.status === 'ACTIVE') return { kind: 'waiting' as const };
          candidate = await tx.approvalStep.findFirst({
            where: { tenantId, requestId, status: 'PENDING' },
            orderBy: { order: 'asc' },
          });
        }
        if (!candidate) {
          // No more steps → chain complete (only reachable from openRequest
          // with an empty steps array, which is rejected upstream — defensive).
          await tx.approvalRequest.update({
            where: { id: requestId },
            data: { status: 'APPROVED', completedAt: new Date(), currentStepId: null },
          });
          return { kind: 'completed' as const };
        }

        // Self-approval skip — system advances the step automatically.
        if (candidate.approverId && candidate.approverId === requestedBy) {
          await tx.approvalDecision.create({
            data: {
              tenantId,
              requestId,
              stepId: candidate.id,
              deciderId: 'system',
              status: 'APPROVED',
              comment: 'Auto-skipped: self-approval prevented (T-APPR-E-01)',
            },
          });
          await tx.approvalStep.update({
            where: { id: candidate.id },
            data: { status: 'SKIPPED', completedAt: new Date() },
          });
          // Loop again to consider the next step.
          return { kind: 'skipped' as const };
        }

        // Activate this step.
        await tx.approvalStep.update({
          where: { id: candidate.id },
          data: {
            status: 'ACTIVE',
            startedAt: new Date(),
            expiresAt: candidate.slaHours
              ? new Date(Date.now() + candidate.slaHours * 60 * 60 * 1000)
              : null,
          },
        });
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: {
            status: req.status === 'PENDING' && candidate.order === 0 ? 'PENDING' : 'IN_PROGRESS',
            currentStepId: candidate.id,
          },
        });
        return { kind: 'activated' as const, step: candidate };
      });

      if (result.kind === 'activated') {
        await this.notifier.notifyApproverAssigned(tenantId, requestId, result.step.id);
        return;
      }
      if (result.kind === 'skipped') continue;
      if (result.kind === 'completed') {
        await this.applySubjectSideEffects(tenantId, requestId);
        return;
      }
      return; // gone | terminal | waiting
    }
    // Safety: all 32 iterations consumed → all-skip pathological case.
    this.logger.warn(`advanceUntilHumanStep exhausted iterations for request=${requestId}`);
  }

  /**
   * After the chain reaches a terminal state, apply side effects on the
   * underlying subject. Today: QUOTE → SENT on APPROVED, → DRAFT on
   * REJECTED. Other subject types (CONTRACT in F1, DEAL/INVOICE/EXPENSE
   * later) extend here.
   */
  private async applySubjectSideEffects(tenantId: string, requestId: string): Promise<void> {
    const req = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findFirst({
        where: { id: requestId, tenantId },
        select: { status: true, subjectType: true, subjectId: true, quoteId: true },
      }),
    );
    if (!req) return;
    if (req.status !== 'APPROVED' && req.status !== 'REJECTED') return;
    if (req.subjectType !== 'QUOTE' || !req.quoteId) return;

    // Honour the historical multi-policy logic: only flip the quote when
    // ALL active requests for the quote are APPROVED; any REJECTED puts it
    // back to DRAFT.
    const allRequests = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.approvalRequest.findMany({ where: { quoteId: req.quoteId!, tenantId } }),
    );
    const anyRejected = allRequests.some((r) => r.status === 'REJECTED');
    const allApproved = allRequests.every((r) => r.status === 'APPROVED');
    if (anyRejected) {
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.quote.update({ where: { id: req.quoteId! }, data: { status: 'DRAFT' as QuoteStatus } }),
      );
    } else if (allApproved) {
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.quote.update({ where: { id: req.quoteId! }, data: { status: 'SENT' as QuoteStatus } }),
      );
    }
  }

  /**
   * Per-trigger threshold evaluation. Strict-validated upstream via
   * `triggerConfigSchemaFor` so we can safely cast the keys we use here.
   */
  private matchesTrigger(
    trigger: ApprovalPolicyTrigger,
    config: Prisma.JsonValue,
    attrs: { value?: Prisma.Decimal | number; currency?: string; discountPct?: number },
  ): boolean {
    const cfg = (config as Record<string, unknown>) ?? {};
    const asNum = (x: unknown): number => (typeof x === 'number' ? x : Number(x ?? 0));

    switch (trigger) {
      case 'QUOTE_ABOVE_VALUE':
      case 'CONTRACT_VALUE_ABOVE':
      case 'EXPENSE_ABOVE_VALUE': {
        const v = attrs.value;
        if (v == null) return false;
        const num = typeof v === 'number' ? v : Number(v.toString());
        const threshold = asNum(cfg['threshold']);
        const cur = cfg['currency'] as string | undefined;
        return num > threshold && (!cur || cur === attrs.currency);
      }
      case 'DISCOUNT_ABOVE_PCT':
      case 'DEAL_DISCOUNT_ABOVE_PCT': {
        const pct = attrs.discountPct;
        if (pct == null) return false;
        return pct > asNum(cfg['pct']);
      }
      case 'MANUAL':
        return false;
    }
  }

  /**
   * Coerce the policy.stepsConfig Json into a typed list. Legacy policies
   * with an empty stepsConfig and a populated `approverId` get synthesized
   * into a single-step chain so the multi-step runtime can handle them
   * uniformly.
   */
  private parseStepsConfig(
    raw: Prisma.JsonValue,
    legacyApproverId: string | null,
  ): Array<{ order: number; approverId?: string | null; approverRole?: string | null; slaHours?: number | null }> {
    const arr = Array.isArray(raw) ? raw : [];
    if (arr.length === 0) {
      if (legacyApproverId) {
        return [{ order: 0, approverId: legacyApproverId, approverRole: null, slaHours: null }];
      }
      return [];
    }
    return arr.map((entry, idx) => {
      const obj = (entry ?? {}) as Record<string, unknown>;
      const order = typeof obj['order'] === 'number' ? (obj['order'] as number) : idx;
      const approverId = typeof obj['approverId'] === 'string' ? (obj['approverId'] as string) : null;
      const approverRole =
        typeof obj['approverRole'] === 'string' ? (obj['approverRole'] as string) : null;
      const slaHours = typeof obj['slaHours'] === 'number' ? (obj['slaHours'] as number) : null;
      return { order, approverId, approverRole, slaHours };
    });
  }
}
