/**
 * The project registry and selection documents under `<appState>/projects`. ProjectWorkspaceStore is their only
 * writer; Settings reads them to resolve a registered project root.
 */

import { z } from 'zod';
import type { StorageMigration } from './storedDocument';

const ProjectInputSchema = z.object({
  inputId: z.string().min(1),
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  source: z.enum(['project_resource', 'external_reference']),
  referenceIdentity: z.object({ device: z.string(), inode: z.string(), birthtimeNs: z.string() }).optional(),
  discoveredAt: z.number(),
  lastModifiedAt: z.number(),
  size: z.number(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
}).passthrough().superRefine((input, ctx) => {
  if (input.source === 'external_reference' && (!input.referenceIdentity || !input.contentSha256)) {
    ctx.addIssue({ code: 'custom', message: 'External capture references require file identity and content hash.' });
  }
});

const ProjectRecordSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  slug: z.string().min(1),
  resourcePath: z.string().min(1),
  knowledgePath: z.string().min(1),
  inputsPath: z.string().min(1),
  inputs: z.array(ProjectInputSchema).default([]),
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
