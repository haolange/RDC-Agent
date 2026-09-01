import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SemanticLaneStatus } from '@shared/types/embedding';
import type { KnowledgeCardDetail, KnowledgeCardSummary, KnowledgeSpace } from '@shared/types/knowledge';
import { parseKnowledgeFrontmatter } from './knowledgeCardSchema';
import { KnowledgeSemanticLaneClosedError } from './knowledgeErrors';
import {
  extractPreview,
  resolveWithinRoot,
  toCardDetail,
  toCardSummary,
  toPosixRelative,
  walkMarkdownFiles,
} from './knowledgeFs';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import {
  KNOWLEDGE_RETRIEVAL_LANES,
  type KnowledgeIndexEntry,
  type KnowledgeLaneHit,
  type KnowledgeLaneResult,
  type KnowledgeQueryRequest,
  type KnowledgeQueryResult,
  type KnowledgeRetrievalLane,
} from './knowledgeLanes';

export interface KnowledgeQueryDependencies {
  listSpaces(): KnowledgeSpace[];
  resolveSemanticLaneStatus(): SemanticLaneStatus;
  index: KnowledgeIndexService;
  readFile(filePath: string): Promise<string>;
  statMtime(filePath: string): Promise<number>;
}

function defaultDependencies(): KnowledgeQueryDependencies {
  const { appPathService } = require('../runtime/AppPathService') as typeof import('../runtime/AppPathService');
  const { storageAdapter } = require('../sessions/StorageAdapter') as typeof import('../sessions/StorageAdapter');
  return {
    listSpaces: () => {
      const spaces: KnowledgeSpace[] = [{
        spaceId: 'user',
        kind: 'user',
        label: 'User',
        rootPath: appPathService.getUserRdxPaths().knowledgePath,
      }];
      for (const project of storageAdapter.listProjects()) {
        spaces.push({
          spaceId: `project:${project.projectId}`,
          kind: 'project',
          label: project.name,
          rootPath: project.knowledgePath,
          projectId: project.projectId,
        });
      }
      return spaces;
    },
    resolveSemanticLaneStatus: () => {
      const { embeddingExecutionService } = require('../settings/EmbeddingExecutionService') as typeof import('../settings/EmbeddingExecutionService');
      return embeddingExecutionService.resolveSemanticLaneStatus();
    },
    index: new KnowledgeIndexService(),
    readFile: (filePath) => fs.readFile(filePath, 'utf8'),
    statMtime: async (filePath) => Math.trunc((await fs.stat(filePath)).mtimeMs),
  };
}

function resolveDeps(overrides: Partial<KnowledgeQueryDependencies>): KnowledgeQueryDependencies {
  if (overrides.listSpaces && overrides.resolveSemanticLaneStatus && overrides.index && overrides.readFile && overrides.statMtime) {
    return overrides as KnowledgeQueryDependencies;
  }
  return { ...defaultDependencies(), ...overrides };
}

function spaceById(spaces: KnowledgeSpace[], spaceId: string): KnowledgeSpace {
  const space = spaces.find((entry) => entry.spaceId === spaceId);
  if (!space) throw new Error(`Unknown knowledge space: ${spaceId}`);
  return space;
}

function matchesScope(entry: KnowledgeIndexEntry, scope: KnowledgeQueryRequest['scope']): boolean {
  if (!scope) return true;
  for (const [axis, value] of Object.entries(scope)) {
    if (axis === 'exclusions' || value == null) continue;
    if (entry.scope[axis as keyof typeof entry.scope] !== value) return false;
  }
  return true;
}

function toHit(entry: KnowledgeIndexEntry, lanes: KnowledgeRetrievalLane[], score: number): KnowledgeLaneHit {
  return {
    cardId: entry.cardId,
    spaceId: entry.spaceId,
    relativePath: entry.relativePath,
    title: entry.title,
    type: entry.type,
    lifecycle: entry.lifecycle,
    score,
    lanes,
  };
}

export class KnowledgeQueryService {
  private resolved?: KnowledgeQueryDependencies;

  constructor(private readonly overrides: Partial<KnowledgeQueryDependencies> = {}) {}

  private get deps(): KnowledgeQueryDependencies {
    this.resolved ??= resolveDeps(this.overrides);
    return this.resolved;
  }

  listSpaces(): KnowledgeSpace[] {
    return this.deps.listSpaces();
  }

  async listCards(spaceId: string): Promise<KnowledgeCardSummary[]> {
    const space = spaceById(this.deps.listSpaces(), spaceId);
    const { realRoot, files } = await walkMarkdownFiles(space.rootPath);
    const cards: KnowledgeCardSummary[] = [];
    for (const absolutePath of files) {
      const relativePath = toPosixRelative(path.relative(realRoot, absolutePath));
      if (!relativePath || relativePath.startsWith('..')) continue;
      try {
        const source = await this.deps.readFile(absolutePath);
        const parsed = parseKnowledgeFrontmatter(source, { spaceId: space.spaceId, relativePath });
        const updatedAt = await this.deps.statMtime(absolutePath);
        cards.push(toCardSummary(space, relativePath, parsed, updatedAt));
      } catch {
        // skip unreadable files in listing
      }
    }
    return cards.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  async getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null> {
    const space = spaceById(this.deps.listSpaces(), spaceId);
    let absolutePath: string;
    try {
      absolutePath = await resolveWithinRoot(space.rootPath, relativePath);
    } catch (error) {
      if (error instanceof Error && error.message === 'Knowledge card not found.') return null;
      throw error;
    }
    try {
      const source = await this.deps.readFile(absolutePath);
      const normalizedRelative = toPosixRelative(relativePath).replace(/^\/+/, '');
      const parsed = parseKnowledgeFrontmatter(source, {
        spaceId: space.spaceId,
        relativePath: normalizedRelative,
      });
      if (!parsed.record.preview) {
        parsed.record.preview = extractPreview(parsed.body);
      }
      const updatedAt = await this.deps.statMtime(absolutePath);
      return toCardDetail(space, normalizedRelative, parsed, updatedAt);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async query(request: KnowledgeQueryRequest = {}): Promise<KnowledgeQueryResult> {
    const snapshot = await this.deps.index.getOrRebuild();
    const lanes = request.lanes?.length ? request.lanes : [...KNOWLEDGE_RETRIEVAL_LANES];
    const universe = snapshot.cards.filter((entry) => {
      if (request.spaceIds && !request.spaceIds.includes(entry.spaceId)) return false;
      if (request.type && entry.type && !request.type.includes(entry.type)) return false;
      if (request.lifecycle && entry.lifecycle && !request.lifecycle.includes(entry.lifecycle)) return false;
      if (request.asOf != null && entry.updatedAt > request.asOf) return false;
      return matchesScope(entry, request.scope);
    });
    const laneResults: KnowledgeLaneResult[] = [];
    const merged = new Map<string, KnowledgeLaneHit>();
    let semantic: SemanticLaneStatus | null = null;

    for (const lane of lanes) {
      if (lane === 'Semantic') {
        semantic = this.deps.resolveSemanticLaneStatus();
        laneResults.push({ lane, hits: [], semantic });
        continue;
      }
      const hits: KnowledgeLaneHit[] = [];
      for (const entry of universe) {
        const score = scoreLane(lane, entry, request);
        if (score <= 0) continue;
        hits.push(toHit(entry, [lane], score));
      }
      hits.sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath));
      laneResults.push({ lane, hits });
      for (const hit of hits) {
        const existing = merged.get(hit.cardId);
        if (!existing) {
          merged.set(hit.cardId, hit);
          continue;
        }
        existing.score += hit.score;
        if (!existing.lanes.includes(lane)) existing.lanes.push(lane);
      }
    }

    return {
      hits: [...merged.values()].sort((left, right) => right.score - left.score),
      lanes: laneResults,
      semantic,
    };
  }

  requireSemanticReady(): SemanticLaneStatus {
    const status = this.deps.resolveSemanticLaneStatus();
    if (status.availability === 'unavailable' || status.availability === 'stale') {
      throw new KnowledgeSemanticLaneClosedError(status.availability, status.reason);
    }
    return status;
  }
}

function scoreLane(lane: KnowledgeRetrievalLane, entry: KnowledgeIndexEntry, request: KnowledgeQueryRequest): number {
  const text = request.text?.trim().toLocaleLowerCase();
  switch (lane) {
    case 'Identity/Path': {
      if (request.cardId && entry.cardId === request.cardId) return 10;
      if (request.relativePath && entry.relativePath === request.relativePath) return 8;
      if (text && (entry.cardId.toLocaleLowerCase().includes(text) || entry.relativePath.toLocaleLowerCase().includes(text))) {
        return 4;
      }
      return request.cardId || request.relativePath ? 0 : 1;
    }
    case 'Scope/Metadata': {
      if (!request.scope && !request.type && !request.lifecycle) return 1;
      let score = 0;
      if (request.type && entry.type && request.type.includes(entry.type)) score += 3;
      if (request.lifecycle && entry.lifecycle && request.lifecycle.includes(entry.lifecycle)) score += 2;
      if (request.scope && matchesScope(entry, request.scope)) score += 4;
      return score;
    }
    case 'Lexical':
      if (!text) return 1;
      return entry.lexical.includes(text) ? 5 : 0;
    case 'Structural':
      if (!text) return entry.headings.length > 0 ? 1 : 0;
      return entry.headings.some((heading) => heading.toLocaleLowerCase().includes(text)) ? 4 : 0;
    case 'Relation/Graph': {
      if (!request.relationTargetCardId) return entry.relations.length > 0 ? 1 : 0;
      return entry.relations.some((relation) => relation.targetCardId === request.relationTargetCardId) ? 6 : 0;
    }
    case 'Temporal/Version':
      return entry.updatedAt > 0 ? 1 : 0;
    default:
      return 0;
  }
}

export const knowledgeQueryService = new KnowledgeQueryService();
