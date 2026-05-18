import { Injectable, Logger } from '@nestjs/common';
import { ApprovalStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';

/**
 * Phase 2 F2 — fan-out for approval lifecycle notifications.
 *
 * Sends in-app notifications (Socket.IO push + Notification row) on:
 *   - approver assigned (step activated, you're next)
 *   - request decided (APPROVED/REJECTED/EXPIRED) — fan out to requester
 *   - request withdrawn — FYI to current step approver
 *
 * Email side-effects are intentionally deferred: this module piggybacks on
 * the in-app channel for the MVP. The email channel can be plugged in by
 * injecting EmailService here and dispatching transactional templates;
 * that's a small extension when SMTP credentials per tenant are wired.
 *
 * Cooldown — to defend T-APPR-D-01 (notification storm), each (approverId,
 * requestId) pair is rate-limited to ONE in-app notification per hour at
 * the service layer. The check is done via Notification table scan over
 * the last 60 min for the same `data.requestId` payload — a cheap query
 * given the per-user index `(tenantId, userId, isRead, createdAt)`.
 */
@Injectable()
export class ApprovalsNotifierService {
  private readonly logger = new Logger(ApprovalsNotifierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Step just activated → notify the assigned approver.
   * Role-resolved steps (approverRole set, no approverId) are NOT notified
   * here: role broadcast is a follow-up (requires a tenant role→users map).
   */
  async notifyApproverAssigned(tenantId: string, requestId: string, stepId: string): Promise<void> {
    try {
      const step = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.approvalStep.findFirst({
          where: { id: stepId, tenantId },
          include: { request: { select: { subjectType: true, subjectId: true } } },
        }),
      );
      if (!step?.approverId) return;
      if (await this.isOnCooldown(tenantId, step.approverId, requestId)) return;

      await this.notifications.create(tenantId, {
        userId: step.approverId,
        type: NotificationType.APPROVAL_REQUEST,
        title: 'Approval requested',
        body: `You're up at step ${step.order + 1}`,
        data: {
          requestId,
          stepId,
          subjectType: step.request.subjectType,
          subjectId: step.request.subjectId,
        } as unknown as Prisma.InputJsonValue,
      });
      void this.audit.log({
        action: 'approval.notification.sent',
        subjectType: 'approval_request',
        subjectId: requestId,
        metadata: { stepId, approverId: step.approverId, channel: 'IN_APP' },
      });
    } catch (err) {
      // Never propagate notifier failures — the workflow state has already
      // committed and is correct on its own.
      this.logger.warn(`notifyApproverAssigned failed: ${(err as Error).message}`);
    }
  }

  /**
   * Terminal transition reached → notify the requester.
   */
  async notifyTerminal(
    tenantId: string,
    requestId: string,
    status: ApprovalStatus,
    deciderId: string | undefined,
  ): Promise<void> {
    try {
      const req = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.approvalRequest.findFirst({
          where: { id: requestId, tenantId },
          select: { requestedBy: true, subjectType: true, subjectId: true },
        }),
      );
      if (!req) return;
      await this.notifications.create(tenantId, {
        userId: req.requestedBy,
        type: NotificationType.APPROVAL_DECIDED,
        title: `Approval ${status.toLowerCase()}`,
        body:
          status === 'APPROVED'
            ? 'Your request was approved'
            : status === 'REJECTED'
              ? 'Your request was rejected'
              : 'Your request expired',
        data: {
          requestId,
          status,
          subjectType: req.subjectType,
          subjectId: req.subjectId,
          deciderId: deciderId ?? null,
        } as unknown as Prisma.InputJsonValue,
      });
      void this.audit.log({
        action: 'approval.request.decided',
        subjectType: 'approval_request',
        subjectId: requestId,
        metadata: { status, deciderId },
      });
    } catch (err) {
      this.logger.warn(`notifyTerminal failed: ${(err as Error).message}`);
    }
  }

  async notifyWithdrawn(
    tenantId: string,
    requestId: string,
    actorId: string,
    reason: string,
  ): Promise<void> {
    try {
      const req = await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.approvalRequest.findFirst({
          where: { id: requestId, tenantId },
          include: { currentStep: true },
        }),
      );
      if (!req) return;
      if (req.currentStep?.approverId) {
        await this.notifications.create(tenantId, {
          userId: req.currentStep.approverId,
          type: NotificationType.APPROVAL_DECIDED,
          title: 'Approval withdrawn',
          body: `Request withdrawn — no action needed`,
          data: { requestId, reason } as unknown as Prisma.InputJsonValue,
        });
      }
      void this.audit.log({
        action: 'approval.request.withdrawn',
        subjectType: 'approval_request',
        subjectId: requestId,
        metadata: { actorId, reason },
      });
    } catch (err) {
      this.logger.warn(`notifyWithdrawn failed: ${(err as Error).message}`);
    }
  }

  async notifyExpired(tenantId: string, requestId: string, requesterId: string): Promise<void> {
    try {
      await this.notifications.create(tenantId, {
        userId: requesterId,
        type: NotificationType.APPROVAL_DECIDED,
        title: 'Approval expired',
        body: 'Your approval request expired (SLA exceeded)',
        data: { requestId, status: 'EXPIRED' } as unknown as Prisma.InputJsonValue,
      });
      void this.audit.log({
        action: 'approval.request.expired',
        subjectType: 'approval_request',
        subjectId: requestId,
        metadata: { requesterId },
      });
    } catch (err) {
      this.logger.warn(`notifyExpired failed: ${(err as Error).message}`);
    }
  }

  /**
   * Cooldown — 60 min per (approver, request). Queries the Notification
   * table for any APPROVAL_REQUEST row to this user whose `data.requestId`
   * matches; returns true if at least one exists within the last hour.
   */
  private async isOnCooldown(tenantId: string, userId: string, requestId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.notification.findFirst({
        where: {
          tenantId,
          userId,
          type: NotificationType.APPROVAL_REQUEST,
          createdAt: { gte: cutoff },
          // Postgres JSONB containment: `data @> '{"requestId":"..."}'`.
          data: { path: ['requestId'], equals: requestId } as Prisma.JsonNullableFilter,
        },
        select: { id: true },
      }),
    );
    return recent != null;
  }
}
