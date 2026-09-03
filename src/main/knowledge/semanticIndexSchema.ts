import { z } from 'zod';
import {
  SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION,
  type EmbeddingBatchResult,
  type SemanticIndexSnapshot,
} from '@shared/types/embedding';

export const SemanticIndexChunkSchema = z.object({
  cardId: z.string().min(1),
  spaceId: z.string().min(1),
  relativePath: z.string().min(1),
  title: z.string(),
  type: z.string().optional(),
  lifecycle: z.string().optional(),
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
}).strict();

export const SemanticIndexSnapshotSchema = z.object({
  schemaVersion: z.literal(SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION),
  identity: z.string().min(1),
  dimensions: z.number().int().positive(),
  chunker: z.string().min(1),
  corpusHash: z.string().min(1),
  catalogRevision: z.string().min(1),
  builtAt: z.string().min(1),
  chunkCount: z.number().int().nonnegative(),
  chunks: z.array(SemanticIndexChunkSchema),
  vectors: z.array(z.array(z.number().finite())),
}).strict();

export type SemanticIndexIntegrityReason = 'incomplete-vectors' | 'invalid-vectors' | 'dimension-mismatch';

export function parseSemanticIndexSnapshot(raw: unknown): SemanticIndexSnapshot | null {
  const parsed = SemanticIndexSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function inspectSemanticIndexVectors(
  snapshot: SemanticIndexSnapshot,
  expectedDimensions: number,
): SemanticIndexIntegrityReason | null {
  if (snapshot.chunks.length !== snapshot.chunkCount || snapshot.vectors.length !== snapshot.chunkCount) {
    return 'incomplete-vectors';
  }
  if (snapshot.dimensions !== expectedDimensions) {
    return 'dimension-mismatch';
  }
  for (const row of snapshot.vectors) {
    if (row.length !== expectedDimensions || row.length === 0) return 'dimension-mismatch';
    if (row.some((value) => !Number.isFinite(value))) return 'invalid-vectors';
  }
  return null;
}

export function assertValidEmbeddingBatch(
  texts: readonly string[],
  result: EmbeddingBatchResult,
  expectedDimensions: number,
): void {
  if (result.dimensions !== expectedDimensions) {
    throw new EmbeddingIndexValidationError('dimension-mismatch');
  }
  if (result.vectors.length !== texts.length) {
    throw new EmbeddingIndexValidationError('incomplete-vectors');
  }
  const seen = new Set<number>();
  for (let index = 0; index < result.vectors.length; index += 1) {
    const row = result.vectors[index];
    const embedding = row.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new EmbeddingIndexValidationError('incomplete-vectors');
    }
    if (embedding.length !== expectedDimensions) {
      throw new EmbeddingIndexValidationError('dimension-mismatch');
    }
    if (embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      throw new EmbeddingIndexValidationError('invalid-vectors');
    }
    const rowIndex = typeof row.index === 'number' ? row.index : index;
    if (rowIndex < 0 || rowIndex >= texts.length || seen.has(rowIndex)) {
      throw new EmbeddingIndexValidationError('incomplete-vectors');
    }
    seen.add(rowIndex);
  }
  if (seen.size !== texts.length) {
    throw new EmbeddingIndexValidationError('incomplete-vectors');
  }
}

export class EmbeddingIndexValidationError extends Error {
  readonly code = 'EMBEDDING_INDEX_INVALID';
  readonly reason: SemanticIndexIntegrityReason;

  constructor(reason: SemanticIndexIntegrityReason) {
    super(`EMBEDDING_INDEX_INVALID: ${reason}`);
    this.name = 'EmbeddingIndexValidationError';
    this.reason = reason;
  }
}
