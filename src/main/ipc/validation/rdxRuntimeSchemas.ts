import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';

const ResourceScopeMutableSchema = z.enum(['user', 'project']);

const ScopedResourceKindSchema = z.enum([
  'agent',
  'skill',
  'mcp',
  'hook',
  'policy',
  'knowledge',
  'memory',
]);

const HookEventSchema = z.enum([
  'session.before-start',
  'session.after-end',
  'turn.before-start',
  'turn.after-end',
  'tool.before-call',
  'tool.after-call',
  'tool.on-error',
  'context.before-compact',
  'context.after-compact',
  'agent.before-handoff',
  'agent.after-handoff',
  'permission.denied',
]);

export const RdxRuntimeOverviewArgsSchema = z.tuple([
  ipcString(4096, 'projectRoot').optional(),
]);

export const ScopedResourceWriteArgsSchema = z.tuple([
  z.object({
    kind: ScopedResourceKindSchema,
    scope: ResourceScopeMutableSchema,
    id: ipcNonEmptyString(200, 'id'),
    content: ipcString(2_000_000, 'content'),
    projectRoot: ipcString(4096, 'projectRoot').optional(),
  }).strict(),
]);

export const ScopedResourceImportArgsSchema = z.tuple([
  z.object({
    kind: ScopedResourceKindSchema,
    scope: ResourceScopeMutableSchema,
    filePath: ipcNonEmptyString(4096, 'filePath'),
    projectRoot: ipcString(4096, 'projectRoot').optional(),
  }).strict(),
]);

export const RdxRuntimeDeleteArgsSchema = z.tuple([
  ScopedResourceKindSchema,
  ResourceScopeMutableSchema,
  ipcNonEmptyString(200, 'id'),
  ipcString(4096, 'projectRoot').optional(),
]);

export const RdxRuntimeRevealArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'sourcePath'),
]);

export const RdxRuntimeTrustHookArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'projectRoot'),
  ipcNonEmptyString(200, 'hookId'),
]);

export const RdxRuntimeRevokeHookArgsSchema = RdxRuntimeTrustHookArgsSchema;

export const RdxRuntimeTrustMcpArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'projectRoot'),
  ipcNonEmptyString(200, 'descriptorId'),
]);

export const RdxRuntimeRevokeMcpArgsSchema = RdxRuntimeTrustMcpArgsSchema;

export const RdxRuntimeTestHookArgsSchema = z.tuple([
  HookEventSchema,
  ipcString(4096, 'projectRoot').optional(),
  ipcString(200, 'hookId').optional(),
]);

export const RdxRuntimeListSnapshotsArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcId(128, 'turnId').optional(),
]);

export const RdxRuntimeGetSnapshotArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcId(128, 'turnId'),
  ipcId(128, 'snapshotId'),
]);
