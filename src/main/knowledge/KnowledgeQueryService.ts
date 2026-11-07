import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { KNOWLEDGE_CARD_TYPES, KNOWLEDGE_LIFECYCLES, type KnowledgeCardDetail, type KnowledgeCardSummary, type KnowledgeSpace, type KnowledgeTopicDocument, type KnowledgeTopic } from '@shared/types/knowledge';
import { appPathService } from '../runtime/AppPathService';
import { storageAdapter } from '../sessions/store/StorageAdapter';
import { parseKnowledgeFrontmatter } from './knowledgeCardSchema';
import {
  extractPreview,
  resolveWithinRoot,
  toCardDetail,
  toCardSummary,
  toPosixRelative,
  walkMarkdownFiles,
} from './knowledgeFs';
import { KnowledgeIndexService, contentHashOf } from './KnowledgeIndexService';
import { BUILTIN_KNOWLEDGE_SYNONYMS, createKnowledgeTextMatcher, normalizeKnowledgeText, type KnowledgeSynonymGroup } from './knowledgeVocabulary';
import { KnowledgeTopicStore } from './KnowledgeTopicStore';
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
  index: KnowledgeIndexService;
  readFile(filePath: string): Promise<string>;
  statMtime(filePath: string): Promise<number>;
  readTopics(): Promise<{ document: KnowledgeTopicDocument; revision: string }>;
}

function defaultDependencies(): KnowledgeQueryDependencies {
  return {
    listSpaces: () => {
      const spaces: KnowledgeSpace[] = [{
        spaceId: 'user',
        kind: 'user',
        label: 'User',
        rootPath: appPathService.getUserRdcPaths().knowledgePath,
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
    index: new KnowledgeIndexService(),
    readFile: (filePath) => fs.readFile(filePath, 'utf8'),
    statMtime: async (filePath) => Math.trunc((await fs.stat(filePath)).mtimeMs),
    readTopics: () => new KnowledgeTopicStore(() => appPathService.getUserRdcPaths().knowledgePath).read(),
  };
}

function resolveDeps(overrides: Partial<KnowledgeQueryDependencies>): KnowledgeQueryDependencies {
  if (overrides.listSpaces && overrides.index && overrides.readFile && overrides.statMtime && overrides.readTopics) {
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
  for (const [axis, values] of Object.entries(scope.exclusions ?? {})) {
    const actual = entry.scope[axis as keyof Omit<typeof entry.scope, 'exclusions'>];
    if (typeof actual === 'string' && values.includes(actual)) return false;
  }
  return true;
}

function toHit(entry: KnowledgeIndexEntry, lanes: KnowledgeRetrievalLane[], score: number, topics: KnowledgeTopic[]): KnowledgeLaneHit {
  return {
    cardId: entry.cardId,
    contentHash: entry.contentHash,
    spaceId: entry.spaceId,
    relativePath: entry.relativePath,
    title: entry.title,
    type: entry.type,
    lifecycle: entry.lifecycle,
    ...(entry.preview ? { preview: entry.preview } : {}),
    updatedAt: entry.updatedAt,
    score,
    lanes,
    relations: entry.relations,
    ...(topics.length ? { topics } : {}),
  };
}

function currentTopics(document: KnowledgeTopicDocument, cardId: string, spaceId: string, contentHash: string): KnowledgeTopic[] {
  if (spaceId !== 'user') return [];
  const assignment = document.assignments.find(item => item.cardId === cardId);
  if (assignment?.contentHash !== contentHash) return [];
  const byId = new Map(document.topics.map(topic => [topic.id, topic]));
  return assignment.topicIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
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
      const contentHash = contentHashOf(source);
      const { document } = await this.deps.readTopics();
      const topics = currentTopics(document, parsed.record.cardId, spaceId, contentHash);
      return {
        ...toCardDetail(space, normalizedRelative, parsed, updatedAt),
        content: source,
        contentHash,
        ...(topics.length ? { topics } : {}),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async query(request: KnowledgeQueryRequest = {}): Promise<KnowledgeQueryResult> {
    const [snapshot, vocabulary] = await Promise.all([this.deps.index.getOrRebuild(), this.deps.readTopics()]);
    const revision = createHash('sha256').update(JSON.stringify([snapshot.revision, vocabulary.revision, BUILTIN_KNOWLEDGE_SYNONYMS])).digest('hex');
    const synonyms: KnowledgeSynonymGroup[] = [...BUILTIN_KNOWLEDGE_SYNONYMS, ...vocabulary.document.topics.map(topic => ({ terms: [topic.label, ...topic.synonyms] }))];
    const matchesText = createKnowledgeTextMatcher(synonyms);
    const topicById = new Map(vocabulary.document.topics.map(topic => [topic.id, topic]));
    const assignments = new Map(vocabulary.document.assignments.map(item => [item.cardId, item]));
    const topicsFor = (entry: KnowledgeIndexEntry): KnowledgeTopic[] => {
      const assignment = entry.spaceId === 'user' ? assignments.get(entry.cardId) : undefined;
      return assignment?.contentHash === entry.contentHash
        ? assignment.topicIds.flatMap(id => topicById.has(id) ? [topicById.get(id)!] : []) : [];
    };
    if (request.expectedRevision && request.expectedRevision !== revision) {
      throw new Error('KNOWLEDGE_INDEX_CHANGED: refresh the search before reading another page.');
    }
    if (request.offset && !request.expectedRevision) {
      throw new Error('KNOWLEDGE_REVISION_REQUIRED: subsequent pages require the search revision.');
    }
    if ((request.offset !== undefined && (!Number.isInteger(request.offset) || request.offset < 0))
      || (request.limit !== undefined && (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100))) {
      throw new Error('KNOWLEDGE_PAGE_INVALID: offset must be non-negative and limit must be between 1 and 100.');
    }
    const allTypes = !!request.type && KNOWLEDGE_CARD_TYPES.every(type => request.type!.includes(type));
    const allLifecycles = !!request.lifecycle && KNOWLEDGE_LIFECYCLES.every(lifecycle => request.lifecycle!.includes(lifecycle));
    // Selecting every known value is a browse operation, including sources that have no classification yet.
    const rankingRequest = { ...request, type: allTypes ? undefined : request.type, lifecycle: allLifecycles ? undefined : request.lifecycle };
    const lanes = request.lanes?.length ? request.lanes : [...KNOWLEDGE_RETRIEVAL_LANES];
    const universe = snapshot.cards.filter((entry) => {
      if (request.spaceIds && !request.spaceIds.includes(entry.spaceId)) return false;
      if (request.cardId && request.cardId !== entry.cardId) return false;
      if (request.relativePath && request.relativePath !== entry.relativePath) return false;
      if (request.relationTargetCardId && !entry.relations.some(relation => relation.targetCardId === request.relationTargetCardId)) return false;
      if (request.type && (entry.type ? !request.type.includes(entry.type) : !allTypes)) return false;
      // Retired cards remain browsable and explicitly queryable for audit, but
      // do not enter ordinary retrieval packs or Agent context.
      if (!request.lifecycle && entry.lifecycle === 'retired') return false;
      if (request.lifecycle && (entry.lifecycle ? !request.lifecycle.includes(entry.lifecycle) : !allLifecycles)) return false;
      if (request.asOf != null && entry.updatedAt > request.asOf) return false;
      if (request.text?.trim() && !textMatches(entry, request.text, topicsFor(entry), matchesText)) return false;
      return matchesScope(entry, request.scope);
    });
    const laneResults: KnowledgeLaneResult[] = [];
    const merged = new Map<string, KnowledgeLaneHit>();

    for (const lane of lanes) {
      const hits: KnowledgeLaneHit[] = [];
      for (const entry of universe) {
        const topics = topicsFor(entry);
        const score = scoreLane(lane, entry, rankingRequest, topics, matchesText);
        if (score <= 0) continue;
        hits.push(toHit(entry, [lane], score, topics));
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

    const ordered = [...merged.values()].sort((left, right) => right.score - left.score || left.cardId.localeCompare(right.cardId));
    const offset = request.offset ?? 0;
    const hits = request.limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + request.limit);
    const pageIds = new Set(hits.map(hit => hit.cardId));
    const { offset: _offset, limit: _limit, expectedRevision: _expectedRevision, ...semanticRequest } = request;
    return {
      hits,
      lanes: laneResults.map(result => ({ ...result, hits: result.hits.filter(hit => pageIds.has(hit.cardId)) })),
      revision,
      total: ordered.length,
      ...(offset + hits.length < ordered.length ? { nextOffset: offset + hits.length } : {}),
      queryFingerprint: createHash('sha256').update(JSON.stringify([semanticRequest, vocabulary.revision, BUILTIN_KNOWLEDGE_SYNONYMS])).digest('hex'),
    };
  }
}

function topicText(topics: KnowledgeTopic[]): string { return topics.flatMap(topic => [topic.label, ...topic.synonyms]).join(' '); }
function textMatches(entry: KnowledgeIndexEntry, query: string, topics: KnowledgeTopic[], matches: (input: string, query: string) => boolean): boolean {
  return matches([entry.cardId, entry.relativePath, entry.title, entry.lexical, ...entry.headings, topicText(topics)].join(' '), query);
}

function scoreLane(lane: KnowledgeRetrievalLane, entry: KnowledgeIndexEntry, request: KnowledgeQueryRequest, topics: KnowledgeTopic[], matches: (input: string, query: string) => boolean): number {
  const text = request.text?.trim();
  switch (lane) {
    case 'Identity/Path': {
      if (request.cardId && entry.cardId === request.cardId) return 10;
      if (request.relativePath && entry.relativePath === request.relativePath) return 8;
      if (text && (normalizeKnowledgeText(entry.cardId).includes(normalizeKnowledgeText(text)) || normalizeKnowledgeText(entry.relativePath).includes(normalizeKnowledgeText(text)))) {
        return 4;
      }
      return 0;
    }
    case 'Scope/Metadata': {
      if (!request.scope && !request.type && !request.lifecycle) return 0;
      let score = 0;
      if (request.type && entry.type && request.type.includes(entry.type)) score += 3;
      if (request.lifecycle && entry.lifecycle && request.lifecycle.includes(entry.lifecycle)) score += 2;
      if (request.scope && matchesScope(entry, request.scope)) score += 4;
      return score;
    }
    case 'Lexical':
      if (!text) return request.cardId || request.relativePath || request.relationTargetCardId || request.scope || request.type || request.lifecycle || request.asOf !== undefined ? 0 : 1;
      return matches(`${entry.lexical} ${topicText(topics)}`, text)
        ? (normalizeKnowledgeText(entry.lexical).includes(normalizeKnowledgeText(text)) ? 5 : 3) : 0;
    case 'Structural':
      if (!text) return entry.headings.length > 0 ? 1 : 0;
      return entry.headings.some((heading) => normalizeKnowledgeText(heading).includes(normalizeKnowledgeText(text))) ? 4 : 0;
    case 'Relation/Graph': {
      if (!request.relationTargetCardId) return 0;
      return entry.relations.some((relation) => relation.targetCardId === request.relationTargetCardId) ? 6 : 0;
    }
    case 'Temporal/Version':
      return request.asOf !== undefined && entry.updatedAt <= request.asOf ? 1 : 0;
    default:
      return 0;
  }
}

export const knowledgeQueryService = new KnowledgeQueryService();
