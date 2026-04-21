-- Add SEND_CAMPAIGN to WorkflowActionType enum
ALTER TYPE "WorkflowActionType" ADD VALUE IF NOT EXISTS 'SEND_CAMPAIGN';
