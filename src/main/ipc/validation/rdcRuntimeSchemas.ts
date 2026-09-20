import { z } from 'zod';
import { CANONICAL_HOOK_EVENTS } from '@shared/types/rdcRuntime';
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

const HookEventSchema = z.enum(CANONICAL_HOOK_EVENTS);

export const RdcRuntimeOverviewArgsSchema = z.tuple([
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

export const RdcRuntimeDeleteArgsSchema = z.tuple([
  ScopedResourceKindSchema,
  ResourceScopeMutableSchema,
  ipcNonEmptyString(200, 'id'),
  ipcString(4096, 'projectRoot').optional(),
]);

export const RdcRuntimeRevealArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'sourcePath'),
]);

export const RdcRuntimeTrustHookArgsSchema = z.tuple([
  // Omitted / null projectRoot is user-scope; a path is project-scope only.
  ipcString(4096, 'projectRoot').nullish(),
  ipcNonEmptyString(200, 'hookId'),
]);

export const RdcRuntimeRevokeHookArgsSchema = RdcRuntimeTrustHookArgsSchema;

export const RdcRuntimeTrustMcpArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'projectRoot'),
  ipcNonEmptyString(200, 'descriptorId'),
]);

export const RdcRuntimeRevokeMcpArgsSchema = RdcRuntimeTrustMcpArgsSchema;

export const RdcRuntimeTestHookArgsSchema = z.tuple([
  HookEventSchema,
  ipcString(4096, 'projectRoot').optional(),
  ipcString(200, 'hookId').optional(),
]);

export const RdcRuntimeListSnapshotsArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcId(128, 'turnId').optional(),
]);

export const RdcRuntimeGetSnapshotArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcId(128, 'turnId'),
  ipcId(128, 'snapshotId'),
]);
