/**
 * Shared IPC arg schemas (empty arity and common ID helpers).
 */
import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

/** Zero-argument IPC channels — reject unexpected payloads. */
export const EmptyArgsSchema = z.tuple([]);

export const OptionalSessionIdArgsSchema = z.tuple([
  ipcId(128, 'sessionId').optional(),
]);

export const SessionIdArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
]);

export const ProjectIdArgsSchema = z.tuple([
  ipcId(128, 'projectId'),
]);

export const OptionalProjectIdArgsSchema = z.tuple([
  ipcId(128, 'projectId').optional(),
]);

export const RunIdArgsSchema = z.tuple([
  ipcId(128, 'runId'),
]);

export const FilePathSchema = ipcNonEmptyString(4096, 'path');
export const OptionalFilePathSchema = ipcString(4096, 'path');
export const FilePathArraySchema = z
  .array(FilePathSchema)
  .max(64, 'filePaths exceeds 64 items');
