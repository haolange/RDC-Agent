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
  ipcString(200, 'title').optional(),
]);

export const SessionRenameArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcNonEmptyString(200, 'title'),
]);

export const SessionIdOnlyArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
]);

export const SessionOutputsListArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  ipcId(128, 'runId').optional(),
]);

export const SessionAttachmentsImportArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
  FilePathArraySchema,
]);

export const RunListArgsSchema = z.tuple([
  ipcId(128, 'sessionId'),
]);
