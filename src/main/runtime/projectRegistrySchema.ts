/**
 * The project registry and selection documents under `<appState>/projects`. ProjectWorkspaceStore is their only
 * writer; Settings reads them to resolve a registered project root.
 */

import { z } from 'zod';
import { ProjectInputRecordSchema } from '@shared/types/session';
import type { StorageMigration } from './storedDocument';

const ProjectRecordSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  slug: z.string().min(1),
  resourcePath: z.string().min(1),
  knowledgePath: z.string().min(1),
  inputsPath: z.string().min(1),
  inputs: z.array(ProjectInputRecordSchema).default([]),
  inputsUpdatedAt: z.number(),
  replayCleanupPending: z.object({ requestedAt: z.number(), captureHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/u)), error: z.string().optional() }).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSessionId: z.string().optional(),
}).passthrough();

export const ProjectRegistryV1Schema = z.object({
  schemaVersion: z.literal('1'),
  projects: z.array(ProjectRecordSchema),
});

export const PROJECT_REGISTRY_MIGRATIONS: StorageMigration<z.infer<typeof ProjectRegistryV1Schema>>[] = [
  { schemaVersion: '1', schema: ProjectRegistryV1Schema },
];

export const SelectionStateSchema = z.object({
  projectId: z.string().nullable(),
  sessionId: z.string().nullable(),
});
