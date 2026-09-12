import { z, type ZodType } from 'zod';
import {
  KNOWLEDGE_CARD_TYPES,
  KNOWLEDGE_LIFECYCLES,
} from '@shared/types/knowledge';
import type { StorageMigration } from '../sessions/storageSchema';
import { KnowledgeRelationSchema, KnowledgeScopeSchema } from './knowledgeCardSchema';
import {
  KNOWLEDGE_INDEX_SCHEMA_VERSION,
  type KnowledgeIndexSnapshot,
} from './knowledgeLanes';

export const KnowledgeIndexEntrySchema = z.object({
  cardId: z.string().trim().min(1),
  spaceId: z.string().trim().min(1),
  relativePath: z.string().trim().min(1),
  title: z.string(),
  type: z.enum(KNOWLEDGE_CARD_TYPES).optional(),
  lifecycle: z.enum(KNOWLEDGE_LIFECYCLES).optional(),
  scope: KnowledgeScopeSchema,
  relations: z.array(KnowledgeRelationSchema),
  headings: z.array(z.string()),
  lexical: z.string(),
  updatedAt: z.number().int(),
  contentHash: z.string().min(1),
  sourceStatus: z.string().optional(),
  caseId: z.string().optional(),
  preview: z.string().optional(),
}).strict();

export const KnowledgeIndexSnapshotSchema = z.object({
  schemaVersion: z.union([
    z.literal(KNOWLEDGE_INDEX_SCHEMA_VERSION),
    z.literal(String(KNOWLEDGE_INDEX_SCHEMA_VERSION)),
  ]).transform(() => KNOWLEDGE_INDEX_SCHEMA_VERSION),
  revision: z.string().min(1),
  builtAt: z.string().min(1),
  cards: z.array(KnowledgeIndexEntrySchema),
}).strict();

export const KNOWLEDGE_INDEX_MIGRATIONS: StorageMigration<KnowledgeIndexSnapshot>[] = [
  {
    schemaVersion: String(KNOWLEDGE_INDEX_SCHEMA_VERSION),
    schema: KnowledgeIndexSnapshotSchema as ZodType<KnowledgeIndexSnapshot>,
  },
];
