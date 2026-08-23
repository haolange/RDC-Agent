/**
 * Zod schemas for priority IPC channels (settings / workflow / memory).
 */
import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

export const MemoryScopeSchema = z.enum(['user', 'project']);

export const MemoryIssueApprovalTokenArgsSchema = z.tuple([
  z.object({
    action: z.enum(['memory.write', 'memory.delete']),
    scope: MemoryScopeSchema,
    name: ipcString(200, 'name').optional(),
    projectRoot: ipcString(1024, 'projectRoot').optional(),
  }),
]);

export const MemoryListArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcString(1024, 'projectRoot').optional(),
]);

export const MemoryGetArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcNonEmptyString(200, 'name'),
  ipcString(1024, 'projectRoot').optional(),
]);

export const MemoryWriteArgsSchema = z.tuple([
  z.object({
    scope: MemoryScopeSchema,
    projectRoot: ipcString(1024, 'projectRoot').optional(),
    approvalToken: ipcNonEmptyString(128, 'approvalToken'),
    name: ipcNonEmptyString(200, 'name'),
    description: ipcNonEmptyString(2000, 'description'),
    type: z.enum(['user', 'feedback', 'project', 'reference']),
    content: ipcNonEmptyString(200_000, 'content'),
    tags: z.array(ipcString(64, 'tag')).max(32).optional(),
  }).strict(),
]);

export const MemoryDeleteArgsSchema = z.tuple([
  MemoryScopeSchema,
  ipcNonEmptyString(200, 'name'),
  ipcNonEmptyString(128, 'approvalToken'),
  ipcString(1024, 'projectRoot').optional(),
]);

export const SettingsSetArgsSchema = z.tuple([
  z.record(z.string(), z.unknown()),
]);

export const SettingsAgentIdArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'agentId'),
]);

export const SettingsProviderIdArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
]);

export const SettingsHasProviderSecretArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
]);

export const SettingsGetEffectiveCatalogArgsSchema = z.tuple([
  ipcNonEmptyString(200, 'providerId'),
  // Electron / browser bridge structured-clone turns omitted optional args into null.
  ipcString(200, 'accountId').nullish(),
]);

export const SettingsImportAgentManifestArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'filePath'),
]);

export const SettingsGetResolvedShellArgsSchema = z.tuple([
  ipcString(4096, 'executable'),
]);

export const RuntimeLogListArgsSchema = z.tuple([
  z.object({
    scope: z.enum(['app', 'session']),
    sessionId: z.union([ipcId(128, 'sessionId'), z.null()]).optional(),
  }).strict(),
]);

export const WorkflowResumeArgsSchema = z.tuple([
  ipcId(128, 'sessionId').optional(),
]);

export const WorkflowStopArgsSchema = z.tuple([
  ipcId(128, 'runId').optional(),
]);

export const WorkflowGetRunUsageArgsSchema = z.tuple([
  z.object({
    sessionId: ipcId(128, 'sessionId'),
    runId: ipcId(128, 'runId').optional(),
  }).strict(),
]);
