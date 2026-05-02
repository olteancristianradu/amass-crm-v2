/**
 * WorkflowRunProcessor — BullMQ consumer for delayed WAIT_DAYS step resumption.
 *
 * When a workflow hits a WAIT_DAYS step, the engine enqueues a delayed job
 * here. When the job fires, we resume the run from the next step.
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_WORKFLOWS } from '../../infra/queue/queue.constants';
import { WorkflowsService, WorkflowStepJobPayload } from './workflows.service';

// FIX (P1-9): same lock/stalled hardening as ImportProcessor — workflow
// runs that hang (e.g. worker killed during HTTP webhook step) must not
// tie up the queue forever.
@Processor(QUEUE_WORKFLOWS, {
  lockDuration: 300_000,
  stalledInterval: 30_000,
  maxStalledCount: 1,
})
export class WorkflowRunProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowRunProcessor.name);

  /** P1-9: maximum total step executions per workflow run. Once exceeded,
   * the run is force-failed to break runaway loops created by a workflow
   * triggering itself (or a chain Workflow A → B → A). */
  private static readonly MAX_STEPS_PER_RUN = 200;

  constructor(private readonly workflows: WorkflowsService) {
    super();
  }

  async process(job: Job<WorkflowStepJobPayload>): Promise<void> {
    const { runId, tenantId, stepIndex } = job.data;
    if (stepIndex >= WorkflowRunProcessor.MAX_STEPS_PER_RUN) {
      this.logger.error(
        `Workflow run %s exceeded max-steps cap (%d) — force-failing to break loop`,
        runId,
        WorkflowRunProcessor.MAX_STEPS_PER_RUN,
      );
      await this.workflows.markFailed(runId, tenantId, 'MAX_STEPS_EXCEEDED');
      return;
    }
    this.logger.log('Resuming workflow run %s from step %d', runId, stepIndex);
    await this.workflows.executeFromStep(runId, tenantId, stepIndex);
  }
}
