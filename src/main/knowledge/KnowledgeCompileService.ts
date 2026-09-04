import { createHash } from 'node:crypto';
import type {
  KnowledgeCompiledHit,
  KnowledgePack,
  KnowledgePackConflict,
  KnowledgeQueryResult,
} from '@shared/types/knowledge';

export type { KnowledgeCompiledHit, KnowledgePack, KnowledgePackConflict };

export interface KnowledgeCompileDependencies {
  now(): Date;
}

export class KnowledgeCompileService {
  constructor(private readonly overrides: Partial<KnowledgeCompileDependencies> = {}) {}

  compile(query: KnowledgeQueryResult, options: { limit?: number } = {}): KnowledgePack {
    const limit = options.limit ?? 12;
    const ranked = [...query.hits]
      .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
      .slice(0, limit);
    const hits: KnowledgeCompiledHit[] = ranked.map((hit) => ({
      ...hit,
      reasons: hit.lanes.map((lane) => `${lane}:${hit.score}`),
    }));
    const conflicts: KnowledgePackConflict[] = [];
    for (const left of hits) {
      for (const right of hits) {
        if (left.cardId >= right.cardId) continue;
        const contradicts = left.lanes.includes('Relation/Graph') && right.lanes.includes('Relation/Graph');
        if (contradicts && left.title !== right.title) {
          conflicts.push({ leftCardId: left.cardId, rightCardId: right.cardId, kind: 'contradicts' });
        }
      }
    }
    const digest = createHash('sha256')
      .update(hits.map((hit) => hit.cardId).join('|'), 'utf8')
      .digest('hex')
      .slice(0, 16);
    return {
      packId: `pack:${digest}`,
      compiledAt: (this.overrides.now ?? (() => new Date()))().toISOString(),
      hits,
      conflicts,
    };
  }
}

export const knowledgeCompileService = new KnowledgeCompileService();
