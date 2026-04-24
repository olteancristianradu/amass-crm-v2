/**
 * WorkflowsService — CRUD + trigger execution engine.
 *
 * Trigger flow:
 *   1. A domain event occurs (deal created, stage changed, etc.).
 *   2. The relevant service calls workflowsService.trigger(event).
 *   3. We find all active workflows matching the trigger + config.
 *   4. For each matching workflow, we create a WorkflowRun and execute
 *      steps synchronously. WAIT_DAYS steps enqueue a delayed BullMQ job
 *      that resumes execution from the next step.
 *
 * Simplifications for MVP:
 *   - SEND_EMAIL logs only — hooks into EmailService in a follow-up.
 *   - One workflow runs at most once per (subject, workflow) pair while RUNNING.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma, Workflow, WorkflowRun, WorkflowStep, WorkflowTrigger } from '@prisma/client';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { QUEUE_WORKFLOWS } from '../../infra/queue/queue.constants';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EmailService } from '../email/email.service';
import {
  CreateWorkflowDto,
  ListWorkflowsQueryDto,
  UpdateWorkflowDto,
} from '@amass/shared';
import { CursorPage, buildCursorArgs, makeCursorPage } from '../../common/pagination';

export interface WorkflowTriggerEvent {
  trigger: WorkflowTrigger;
  subjectType: string;
  subjectId: string;
  tenantId: string;
  /** For DEAL_STAGE_CHANGED: the new stageId */
  stageId?: string;
}

export interface WorkflowStepJobPayload {
  runId: string;
  tenantId: string;
  stepIndex: number;
}

@Injectable()
export class WorkflowsService {
  private readonly logger = new Logger(WorkflowsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_WORKFLOWS) private readonly queue: Queue,
    private readonly campaigns: CampaignsService,
    private readonly emails: EmailService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async create(dto: CreateWorkflowDto): Promise<Workflow> {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflow.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description,
          isActive: dto.isActive ?? true,
          trigger: dto.trigger,
          triggerConfig: (dto.triggerConfig ?? {}) as Prisma.InputJsonValue,
          steps: {
            create: (dto.steps ?? []).map((s, i) => ({
              tenantId,
              order: s.order ?? i,
              actionType: s.actionType,
              actionConfig: (s.actionConfig ?? {}) as Prisma.InputJsonValue,
            })),
          },
        },
        include: { steps: { orderBy: { order: 'asc' } } },
      }),
    );
  }

  async list(q: ListWorkflowsQueryDto): Promise<CursorPage<Workflow>> {
    const { tenantId } = requireTenantContext();
    const items = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflow.findMany({
        where: { tenantId, deletedAt: null },
        ...buildCursorArgs(q.cursor, q.limit ?? 20),
        include: { steps: { orderBy: { order: 'asc' } } },
      }),
    );
    return makeCursorPage(items, q.limit ?? 20);
  }

  async findOne(id: string): Promise<Workflow & { steps: WorkflowStep[]; runs: WorkflowRun[] }> {
    const { tenantId } = requireTenantContext();
    const w = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflow.findFirst({
        where: { id, tenantId, deletedAt: null },
        include: {
          steps: { orderBy: { order: 'asc' } },
          runs: { orderBy: { startedAt: 'desc' }, take: 20 },
        },
      }),
    );
    if (!w) throw new NotFoundException({ code: 'WORKFLOW_NOT_FOUND' });
    return w;
  }

  async update(id: string, dto: UpdateWorkflowDto): Promise<Workflow> {
    const { tenantId } = requireTenantContext();
    await this.findOne(id);
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflow.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description,
          isActive: dto.isActive,
          trigger: dto.trigger,
          triggerConfig: dto.triggerConfig as Prisma.InputJsonValue | undefined,
        },
      }),
    );
  }

  async remove(id: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.findOne(id);
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflow.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  async listRuns(q: ListWorkflowsQueryDto): Promise<CursorPage<WorkflowRun>> {
    const { tenantId } = requireTenantContext();
    const limit = q.limit ?? 20;
    const items = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflowRun.findMany({
        where: { tenantId },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
    );
    return makeCursorPage(items, limit);
  }

  // ── Trigger engine ────────────────────────────────────────────────────────

  /**
   * Called by domain services when a trigger event occurs. Fire-and-forget
   * — errors are caught and logged so they never bubble up to the API response.
   *
   * SECURITY — tenant isolation:
   *   `trigger()` is called from inside a request handler (so ALS has the
   *   right tenant context) but ALSO from the BullMQ workflow processor
   *   when a WAIT_DAYS step resumes — that path has NO ALS context, so
   *   the Prisma extension (Layer 2) and RLS (Layer 3) both no-op. We
   *   therefore wrap every query in `runWithTenant(event.tenantId, ...)`
   *   so `SET LOCAL app.tenant_id` is applied unconditionally. Each query
   *   also keeps its explicit `tenantId: event.tenantId` filter as a
   *   fourth layer of defense.
   */
  async trigger(event: WorkflowTriggerEvent): Promise<void> {
    try {
      const workflows = await this.prisma.runWithTenant(event.tenantId, (tx) =>
        tx.workflow.findMany({
          where: { tenantId: event.tenantId, trigger: event.trigger, isActive: true, deletedAt: null },
          include: { steps: { orderBy: { order: 'asc' } } },
        }),
      );

      for (const workflow of workflows) {
        // For DEAL_STAGE_CHANGED, check that triggerConfig.stageId matches if specified
        if (event.trigger === 'DEAL_STAGE_CHANGED') {
          const cfg = workflow.triggerConfig as Record<string, unknown>;
          if (cfg.stageId && cfg.stageId !== event.stageId) continue;
        }

        // Skip if already running for this subject
        const existing = await this.prisma.runWithTenant(event.tenantId, (tx) =>
          tx.workflowRun.findFirst({
            where: {
              tenantId: event.tenantId,
              workflowId: workflow.id,
              subjectType: event.subjectType,
              subjectId: event.subjectId,
              status: 'RUNNING',
            },
          }),
        );
        if (existing) continue;

        const run = await this.prisma.runWithTenant(event.tenantId, (tx) =>
          tx.workflowRun.create({
            data: {
              tenantId: event.tenantId,
              workflowId: workflow.id,
              subjectType: event.subjectType,
              subjectId: event.subjectId,
              status: 'RUNNING',
              currentStep: 0,
            },
          }),
        );

        await this.executeFromStep(run.id, event.tenantId, 0, workflow.steps);
      }
    } catch (err) {
      this.logger.error('Workflow trigger error for %s/%s: %o', event.subjectType, event.subjectId, err);
    }
  }

  /**
   * Execute steps from `stepIndex`. Stops at WAIT_DAYS (enqueues delayed job).
   * Called on initial trigger and on BullMQ job resume.
   *
   * SECURITY — tenant isolation:
   *   This function runs from BullMQ when a WAIT_DAYS step fires, which is
   *   OUTSIDE any request AsyncLocalStorage context. That means tenantExtension
   *   (Prisma layer 2) no-ops AND Postgres RLS (layer 3) is inactive.
   *   Every query MUST go through runWithTenant(tenantId, ...) so SET LOCAL
   *   app.tenant_id is applied. We also filter by tenantId explicitly on the
   *   first lookup as defense-in-depth.
   */
  async executeFromStep(
    runId: string,
    tenantId: string,
    stepIndex: number,
    steps?: WorkflowStep[],
  ): Promise<void> {
    const { run, allSteps } = await this.prisma.runWithTenant(tenantId, async (tx) => {
      const run = await tx.workflowRun.findFirst({ where: { id: runId, tenantId } });
      if (!run || run.status !== 'RUNNING') return { run: null, allSteps: [] };
      const allSteps =
        steps ??
        (await tx.workflowStep.findMany({
          where: { workflowId: run.workflowId },
          orderBy: { order: 'asc' },
        }));
      return { run, allSteps };
    });
    if (!run) return;

    for (let i = stepIndex; i < allSteps.length; i++) {
      const step = allSteps[i];
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.workflowRun.update({ where: { id: runId }, data: { currentStep: i } }),
      );

      if (step.actionType === 'WAIT_DAYS') {
        const cfg = step.actionConfig as Record<string, unknown>;
        const days = typeof cfg.days === 'number' ? cfg.days : 1;
        const payload: WorkflowStepJobPayload = { runId, tenantId, stepIndex: i + 1 };
        await this.queue.add('resume', payload, { delay: days * 24 * 60 * 60 * 1000 });
        return; // paused — will resume via queue
      }

      await this.executeStep(run, step, tenantId);
    }

    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflowRun.update({
        where: { id: runId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
    );
  }

  private async executeStep(run: WorkflowRun, step: WorkflowStep, tenantId: string): Promise<void> {
    const cfg = step.actionConfig as Record<string, unknown>;
    try {
      if (step.actionType === 'ADD_NOTE') {
        const body = typeof cfg.body === 'string' ? cfg.body : '[Workflow note]';
        const validSubjectTypes = ['COMPANY', 'CONTACT', 'CLIENT'];
        if (validSubjectTypes.includes(run.subjectType)) {
          await this.prisma.runWithTenant(tenantId, (tx) =>
            tx.note.create({
              data: {
                tenantId,
                subjectType: run.subjectType as 'COMPANY' | 'CONTACT' | 'CLIENT',
                subjectId: run.subjectId,
                body,
              },
            }),
          );
        }
      } else if (step.actionType === 'CREATE_TASK') {
        const title = typeof cfg.title === 'string' ? cfg.title : 'Workflow task';
        const priority = typeof cfg.priority === 'string' ? cfg.priority : 'NORMAL';
        const dueInDays = typeof cfg.dueInDays === 'number' ? cfg.dueInDays : 0;
        const dueAt = dueInDays > 0 ? new Date(Date.now() + dueInDays * 86400000) : undefined;
        await this.prisma.runWithTenant(tenantId, (tx) =>
          tx.task.create({
            data: {
              tenantId,
              dealId: run.subjectType === 'DEAL' ? run.subjectId : undefined,
              subjectType:
                run.subjectType !== 'DEAL' ? (run.subjectType as 'COMPANY' | 'CONTACT' | 'CLIENT') : undefined,
              subjectId: run.subjectType !== 'DEAL' ? run.subjectId : undefined,
              title,
              priority: priority as 'LOW' | 'NORMAL' | 'HIGH',
              dueAt,
            },
          }),
        );
      } else if (step.actionType === 'SEND_EMAIL') {
        // Dispatches a transactional email via EmailService. cfg shape:
        //   { to: 'contact@x.ro', subject: '...', bodyHtml: '...', bodyText?: '...' }
        // The send runs in the tenant's context so EmailService picks up
        // the default active email account + audit log hits the right tenant.
        const to = typeof cfg.to === 'string' ? cfg.to : null;
        const subject = typeof cfg.subject === 'string' ? cfg.subject : null;
        const bodyHtml = typeof cfg.bodyHtml === 'string' ? cfg.bodyHtml : null;
        if (!to || !subject || !bodyHtml) {
          this.logger.warn(
            `SEND_EMAIL step for run ${run.id} missing to/subject/bodyHtml — skipping`,
          );
          return;
        }
        await this.emails.sendTransactional(tenantId, {
          to,
          subject,
          bodyHtml,
          bodyText: typeof cfg.bodyText === 'string' ? cfg.bodyText : undefined,
        });
        this.logger.log(`SEND_EMAIL step queued for run ${run.id} to ${to}`);
      } else if (step.actionType === 'SEND_CAMPAIGN') {
        const campaignId = typeof cfg.campaignId === 'string' ? cfg.campaignId : null;
        if (!campaignId) {
          this.logger.warn('SEND_CAMPAIGN step for run %s missing campaignId in config', run.id);
        } else {
          await this.campaigns.launch(campaignId, tenantId);
          this.logger.log('Launched campaign %s from workflow run %s', campaignId, run.id);
        }
      }
    } catch (err) {
      this.logger.error('Step execution failed for run %s step %s: %o', run.id, step.id, err);
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.workflowRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', error: String(err), completedAt: new Date() },
        }),
      );
      throw err;
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.workflowRun.updateMany({
        where: { id: runId, tenantId, status: 'RUNNING' },
        data: { status: 'CANCELLED', completedAt: new Date() },
      }),
    );
  }
}
