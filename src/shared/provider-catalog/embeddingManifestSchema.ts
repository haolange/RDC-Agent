import { z } from 'zod';
import {
  EMBEDDING_PROTOCOLS,
  getEmbeddingAdapterImplementation,
  type EmbeddingAdapterId,
} from './embeddingImplementationRegistry';

const EmbeddingAdapterIdSchema = z.custom<EmbeddingAdapterId>(
  (value) => typeof value === 'string' && Boolean(getEmbeddingAdapterImplementation(value)),
  'no registered embedding adapter implementation',
);

export const EmbeddingProtocolSchema = z.enum(EMBEDDING_PROTOCOLS);

export const EmbeddingModelManifestSchema = z.object({
  modelId: z.string().min(1),
  label: z.string().min(1),
  dimensions: z.number().int().positive(),
  maxInputTokens: z.number().int().positive().optional(),
  factSourceId: z.string().min(1),
}).strict();

export const SurfaceEmbeddingsManifestSchema = z.object({
  protocol: EmbeddingProtocolSchema,
  adapterId: EmbeddingAdapterIdSchema,
  baseUrl: z.string().min(1),
  models: z.array(EmbeddingModelManifestSchema).min(1),
}).strict();

export type EmbeddingModelManifest = z.infer<typeof EmbeddingModelManifestSchema>;
export type SurfaceEmbeddingsManifest = z.infer<typeof SurfaceEmbeddingsManifestSchema>;
