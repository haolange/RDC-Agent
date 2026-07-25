import { z } from 'zod';
import { ipcId } from './IpcPayloadGuard';

export const TraceGetRunArgsSchema = z.tuple([
  ipcId(128, 'runId'),
]);

export const TraceGetEventsArgsSchema = z.tuple([
  ipcId(128, 'runId'),
  z.number().int().nonnegative().max(10_000_000).optional(),
]);

export const TraceGetProjectionArgsSchema = z.tuple([
  ipcId(128, 'sessionId').optional(),
]);

export const TraceExportRunArgsSchema = z.tuple([
  ipcId(128, 'runId'),
]);

export const TraceSwitchBranchArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcId(128, 'branchId'),
]);
