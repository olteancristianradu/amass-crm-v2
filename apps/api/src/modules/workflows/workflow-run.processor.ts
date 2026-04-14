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

@Processor(QUEUE_WORKFLOWS)
export class WorkflowRunProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowRunProcessor.name);

  constructor(private readonly workflows: WorkflowsService) {
    super();
  }

  async process(job: Job<WorkflowStepJobPayload>): Promise<void> {
    const { runId, tenantId, stepIndex } = job.data;
    this.logger.log('Resuming workflow run %s from step %d', runId, stepIndex);
    await this.workflows.executeFromStep(runId, tenantId, stepIndex);
  }
}
