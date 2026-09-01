import { z } from 'zod';
import { ipcId, ipcNonEmptyString, ipcString } from './IpcPayloadGuard';
import { FilePathArraySchema, OptionalProjectIdArgsSchema, ProjectIdArgsSchema } from './commonIpcSchemas';

export const ProjectAddArgsSchema = z.tuple([
  ipcNonEmptyString(4096, 'rootPath'),
]);

export const ProjectSelectArgsSchema = ProjectIdArgsSchema;
export const ProjectRemoveArgsSchema = ProjectIdArgsSchema;
export const ProjectInputsListArgsSchema = ProjectIdArgsSchema;
export const ProjectInputsRefreshArgsSchema = ProjectIdArgsSchema;
export const ProjectInputsImportArgsSchema = ProjectIdArgsSchema;

export const ProjectRenameArgsSchema = z.tuple([
  ipcId(128, 'projectId'),
  ipcNonEmptyString(200, 'newName'),
]);

export const ProjectInputsImportPathsArgsSchema = z.tuple([
  ipcId(128, 'projectId'),
  FilePathArraySchema,
]);

export const SessionListArgsSchema = OptionalProjectIdArgsSchema;

export const SessionCreateArgsSchema = z.tuple([
  ipcId(128, 'projectId'),
  // JSON bridge payloads serialize an omitted optional positional argument as
  // null. Normalize that transport representation at the IPC boundary.
  ipcString(200, 'title').nullable().optional().transform((title) => title ?? undefined),
]);

export const SessionRenameArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcNonEmptyString(200, 'title'),
]);

export const SessionIdOnlyArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
]);

export const SessionSetModelOverrideArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  z.object({
    providerId: ipcNonEmptyString(128, 'providerId'),
    modelId: ipcNonEmptyString(256, 'modelId'),
  }).nullable(),
]);

export const SessionSetAgentIdArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcNonEmptyString(128, 'agentId'),
]);


export const RunListArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
]);
