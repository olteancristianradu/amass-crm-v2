import { z } from 'zod';

export const WorkflowTriggerSchema = z.enum([
  'DEAL_CREATED',
  'DEAL_STAGE_CHANGED',
  'CONTACT_CREATED',
  'COMPANY_CREATED',
]);
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

export const WorkflowActionTypeSchema = z.enum([
  'SEND_EMAIL',
  'CREATE_TASK',
  'ADD_NOTE',
  'WAIT_DAYS',
  'SEND_CAMPAIGN',
]);
export type WorkflowActionType = z.infer<typeof WorkflowActionTypeSchema>;

export const WorkflowStepInputSchema = z.object({
  order: z.number().int().min(0).optional(),
  actionType: WorkflowActionTypeSchema,
  actionConfig: z.record(z.unknown()).default({}),
});
export type WorkflowStepInput = z.infer<typeof WorkflowStepInputSchema>;

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
  trigger: WorkflowTriggerSchema,
  triggerConfig: z.record(z.unknown()).default({}),
  steps: z.array(WorkflowStepInputSchema).default([]),
});
export type CreateWorkflowDto = z.infer<typeof CreateWorkflowSchema>;

export const UpdateWorkflowSchema = CreateWorkflowSchema.partial();
export type UpdateWorkflowDto = z.infer<typeof UpdateWorkflowSchema>;

export const ListWorkflowsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWorkflowsQueryDto = z.infer<typeof ListWorkflowsQuerySchema>;
