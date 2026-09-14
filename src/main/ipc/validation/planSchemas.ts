import { z } from 'zod';
import { ipcId, ipcNonEmptyString } from './IpcPayloadGuard';

const planReference = {
  sessionId: ipcId(128, 'sessionId'),
  planId: ipcId(128, 'planId'),
  revision: z.number().int().positive(),
  uri: ipcNonEmptyString(1024, 'uri'),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
};
export const PlanReadArgsSchema = z.tuple([z.object(planReference).strict()]);
export const PlanIssueApprovalTokenArgsSchema = z.tuple([z.object({
  ...planReference, action: z.enum(['plan.saveToProject', 'plan.export']),
}).strict()]);
export const PlanSaveToProjectArgsSchema = z.tuple([z.object({
  ...planReference, approvalToken: ipcNonEmptyString(128, 'approvalToken'),
}).strict()]);
export const PlanExportArgsSchema = z.tuple([z.object({
  ...planReference, targetPath: ipcNonEmptyString(1024, 'targetPath'),
  approvalToken: ipcNonEmptyString(128, 'approvalToken'),
}).strict()]);
