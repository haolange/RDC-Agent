import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeSpace } from '@shared/types/knowledge';
import { StorageIo } from '../sessions/StorageIo';
import { parseKnowledgeFrontmatter } from './knowledgeCardSchema';
import { KNOWLEDGE_INDEX_MIGRATIONS } from './knowledgeIndexSchema';
import {
  KNOWLEDGE_INDEX_SCHEMA_VERSION,
  knowledgeCorpusHash,
  type KnowledgeIndexEntry,
  type KnowledgeIndexSnapshot,
  type SemanticCorpusDocument,
} from './knowledgeLanes';
import { toPosixRelative, walkMarkdownFiles } from './knowledgeFs';

export interface KnowledgeIndexDependencies {
  listSpaces(): KnowledgeSpace[];
  snapshotPath(): string;
  storage: StorageIo;
  now(): Date;
  readFile(filePath: string): Promise<string>;
  statMtime(filePath: string): Promise<number>;
}

const defaultDependencies = (): KnowledgeIndexDependencies => {
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
    snapshotPath: () => path.join(appPathService.getAppStatePaths().appStateRoot, 'knowledge-index.json'),
    storage: new StorageIo(),
    now: () => new Date(),
    readFile: (filePath) => fs.readFile(filePath, 'utf8'),
    statMtime: async (filePath) => Math.trunc((await fs.stat(filePath)).mtimeMs),
  };
};

function contentHashOf(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function toEntry(
  space: KnowledgeSpace,
  relativePath: string,
  source: string,
  updatedAt: number,
): KnowledgeIndexEntry {
  const parsed = parseKnowledgeFrontmatter(source, { spaceId: space.spaceId, relativePath });
  const headings = [...source.matchAll(/^#{1,3}\s+(.+)$/gm)].map((match) => match[1].trim());
  const lexical = [parsed.record.title, parsed.body, relativePath].join('\n').toLocaleLowerCase();
  return {
    cardId: parsed.record.cardId || `${space.spaceId}:${relativePath}`,
    spaceId: space.spaceId,
    relativePath,
    title: parsed.record.title,
    type: parsed.record.type,
    lifecycle: parsed.record.lifecycle,
    scope: parsed.record.scope ?? {},
    relations: parsed.record.relations ?? [],
    headings,
    lexical,
    updatedAt,
    contentHash: contentHashOf(source),
    sourceStatus: parsed.record.sourceStatus,
    caseId: parsed.record.caseId,
  };
}

function resolveDeps(overrides: Partial<KnowledgeIndexDependencies>): KnowledgeIndexDependencies {
  if (overrides.listSpaces && overrides.snapshotPath && overrides.storage && overrides.now && overrides.readFile && overrides.statMtime) {
    return overrides as KnowledgeIndexDependencies;
  }
  return { ...defaultDependencies(), ...overrides };
}

export class KnowledgeIndexService {
  private resolved?: KnowledgeIndexDependencies;

  constructor(private readonly overrides: Partial<KnowledgeIndexDependencies> = {}) {}

  private get dependencies(): KnowledgeIndexDependencies {
    this.resolved ??= resolveDeps(this.overrides);
    return this.resolved;
  }

  async rebuild(): Promise<KnowledgeIndexSnapshot> {
    const cards: KnowledgeIndexEntry[] = [];
    for (const space of this.dependencies.listSpaces()) {
      const { realRoot, files } = await walkMarkdownFiles(space.rootPath);
      for (const absolutePath of files) {
        const relativePath = toPosixRelative(path.relative(realRoot, absolutePath));
        if (!relativePath || relativePath.startsWith('..')) continue;
        try {
          const source = await this.dependencies.readFile(absolutePath);
          const updatedAt = await this.dependencies.statMtime(absolutePath);
          cards.push(toEntry(space, relativePath, source, updatedAt));
        } catch {
          // skip unreadable files
        }
      }
    }
    cards.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const snapshot: KnowledgeIndexSnapshot = {
      schemaVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION,
      revision: knowledgeCorpusHash(cards),
      builtAt: this.dependencies.now().toISOString(),
      cards,
    };
    const filePath = this.dependencies.snapshotPath();
    this.dependencies.storage.ensureDir(path.dirname(filePath));
    this.dependencies.storage.writeJsonAtomic(filePath, snapshot);
    return snapshot;
  }

  getSnapshot(): KnowledgeIndexSnapshot | null {
    return this.dependencies.storage.readJson(
      this.dependencies.snapshotPath(),
      KNOWLEDGE_INDEX_MIGRATIONS,
    );
  }

  async computeLiveRevision(): Promise<string> {
    const cards: KnowledgeIndexEntry[] = [];
    for (const space of this.dependencies.listSpaces()) {
      const { realRoot, files } = await walkMarkdownFiles(space.rootPath);
      for (const absolutePath of files) {
        const relativePath = toPosixRelative(path.relative(realRoot, absolutePath));
        if (!relativePath || relativePath.startsWith('..')) continue;
        try {
          const source = await this.dependencies.readFile(absolutePath);
          const updatedAt = await this.dependencies.statMtime(absolutePath);
          cards.push(toEntry(space, relativePath, source, updatedAt));
        } catch {
          // skip unreadable files
        }
      }
    }
    cards.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return knowledgeCorpusHash(cards);
  }

  async listCorpusDocuments(): Promise<SemanticCorpusDocument[]> {
    const snapshot = await this.getOrRebuild();
    const spaces = this.dependencies.listSpaces();
    const documents: SemanticCorpusDocument[] = [];
    for (const card of snapshot.cards) {
      const space = spaces.find((entry) => entry.spaceId === card.spaceId);
      if (!space) continue;
      try {
        const absolutePath = path.join(space.rootPath, card.relativePath);
        const source = await this.dependencies.readFile(absolutePath);
        const parsed = parseKnowledgeFrontmatter(source, {
          spaceId: card.spaceId,
          relativePath: card.relativePath,
        });
        documents.push({
          cardId: card.cardId,
          spaceId: card.spaceId,
          relativePath: card.relativePath,
          title: card.title,
          type: card.type,
          lifecycle: card.lifecycle,
          body: parsed.body,
          contentHash: card.contentHash,
        });
      } catch {
        // skip unreadable files
      }
    }
    documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return documents;
  }

  async isSnapshotStale(snapshot: KnowledgeIndexSnapshot | null = this.getSnapshot()): Promise<boolean> {
    if (!snapshot) return true;
    return snapshot.revision !== await this.computeLiveRevision();
  }

  async getOrRebuild(): Promise<KnowledgeIndexSnapshot> {
    const snapshot = this.getSnapshot();
    if (snapshot && !(await this.isSnapshotStale(snapshot))) return snapshot;
    return this.rebuild();
  }
}

export const knowledgeIndexService = new KnowledgeIndexService();
