import { z } from 'zod';

/**
 * Tasks can attach to a Deal OR a polymorphic subject (Company/Contact/
 * Client), but never both. The .superRefine at the end enforces that
 * exactly one of {dealId} or {subjectType + subjectId} is populated.
 * The same invariant is re-checked server-side before we hit Prisma.
 */
export const TaskStatusSchema = z.enum(['OPEN', 'DONE']);
export type TaskStatusDto = z.infer<typeof TaskStatusSchema>;

export const TaskPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH']);
export type TaskPriorityDto = z.infer<typeof TaskPrioritySchema>;

const TaskSubjectTypeSchema = z.enum(['COMPANY', 'CONTACT', 'CLIENT']);

const assertOneLink = (
  val: { dealId?: string; subjectType?: string; subjectId?: string },
  ctx: z.RefinementCtx,
) => {
  const hasDeal = !!val.dealId;
  const hasSubject = !!val.subjectType && !!val.subjectId;
  if (hasDeal && hasSubject) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'task can link to EITHER a deal OR a subject, not both',
    });
  }
  if (!hasDeal && !hasSubject) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'task must link to a deal or a subject',
    });
  }
  if (val.subjectType && !val.subjectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subjectId'],
      message: 'subjectId is required when subjectType is set',
    });
  }
};

export const CreateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
    dueAt: z.coerce.date().optional(),
    priority: TaskPrioritySchema.default('NORMAL'),
    assigneeId: z.string().min(1).max(64).optional(),
    dealId: z.string().min(1).max(64).optional(),
    subjectType: TaskSubjectTypeSchema.optional(),
    subjectId: z.string().min(1).max(64).optional(),
  })
  .superRefine(assertOneLink);
export type CreateTaskDto = z.infer<typeof CreateTaskSchema>;

/**
 * Update is patch-style but we still guard against linking to both a deal
 * AND a subject simultaneously. `status` is NOT here — toggle via the
 * dedicated /tasks/:id/complete and /tasks/:id/reopen endpoints so the
 * service can stamp completedAt and later emit an activity.
 */
export const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    dueAt: z.coerce.date().nullable(),
    priority: TaskPrioritySchema,
    assigneeId: z.string().min(1).max(64).nullable(),
  })
  .partial();
export type UpdateTaskDto = z.infer<typeof UpdateTaskSchema>;

export const ListTasksQuerySchema = z.object({
  status: TaskStatusSchema.optional(),
  assigneeId: z.string().min(1).max(64).optional(),
  dealId: z.string().min(1).max(64).optional(),
  subjectType: TaskSubjectTypeSchema.optional(),
  subjectId: z.string().min(1).max(64).optional(),
  /** filter: only tasks with dueAt <= now + window. Used by /tasks/me. */
  dueBefore: z.coerce.date().optional(),
  mine: z.coerce.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListTasksQueryDto = z.infer<typeof ListTasksQuerySchema>;
