import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeCardRecord, KnowledgeHumanConfirmation, KnowledgeLifecycle, KnowledgeSpace } from '@shared/types/knowledge';
import type { AgentPermissionMode } from '@shared/types/settings';
import { missingCaseChapters, serializeKnowledgeCard } from './knowledgeCardSchema';
import { KnowledgeHumanConfirmationRequiredError, KnowledgeLifecycleError } from './knowledgeErrors';
import { isPathInside, toPosixRelative } from './knowledgeFs';
import { knowledgeIndexService, KnowledgeIndexService } from './KnowledgeIndexService';
import { knowledgeQueryService } from './KnowledgeQueryService';

export interface KnowledgeWriteInput {
  spaceId: string;
  card: KnowledgeCardRecord;
  permissionMode: AgentPermissionMode;
  confirmation: KnowledgeHumanConfirmation;
}

export interface KnowledgePromoteInput {
  spaceId: string;
  card: KnowledgeCardRecord;
  to: Extract<KnowledgeLifecycle, 'verified' | 'promoted' | 'deprecated'>;
  permissionMode: AgentPermissionMode;
  confirmation: KnowledgeHumanConfirmation;
}

export interface KnowledgeWriteDependencies {
  listSpaces(): KnowledgeSpace[];
  writeFile(filePath: string, contents: string): Promise<void>;
  mkdir(dirPath: string): Promise<void>;
  index?: KnowledgeIndexService;
  now(): Date;
}

function assertHumanConfirmation(
  confirmation: KnowledgeHumanConfirmation | undefined,
  permissionMode: AgentPermissionMode,
): void {
  if (confirmation?.explicitHumanConfirmation !== true) {
    throw new KnowledgeHumanConfirmationRequiredError(permissionMode);
  }
}

function resolveSpace(spaces: KnowledgeSpace[], spaceId: string): KnowledgeSpace {
  const space = spaces.find((entry) => entry.spaceId === spaceId);
  if (!space) throw new Error(`Unknown knowledge space: ${spaceId}`);
  return space;
}

function resolveWritePath(space: KnowledgeSpace, relativePath: string): string {
  const normalized = toPosixRelative(relativePath).replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error('Invalid knowledge card path.');
  }
  const absolute = path.resolve(space.rootPath, ...normalized.split('/'));
  if (!isPathInside(space.rootPath, absolute)) {
    throw new Error('Knowledge card path escaped its space root.');
  }
  return absolute;
}

export class KnowledgeWriteService {
  constructor(private readonly overrides: KnowledgeWriteDependencies) {}

  async write(input: KnowledgeWriteInput): Promise<KnowledgeCardRecord> {
    assertHumanConfirmation(input.confirmation, input.permissionMode);
    if (input.card.lifecycle === 'candidate') {
      throw new KnowledgeLifecycleError('KNOWLEDGE_LIFECYCLE_INVALID: persist Candidate via KnowledgeCandidateService, not Write.');
    }
    if (input.card.lifecycle === 'verified' && input.card.type === 'case') {
      const missing = missingCaseChapters(input.card.chapters);
      if (missing.length > 0) {
        throw new KnowledgeLifecycleError(`KNOWLEDGE_LIFECYCLE_INVALID: case cannot be verified; missing chapters: ${missing.join(',')}`);
      }
    }
    const space = resolveSpace(this.overrides.listSpaces(), input.spaceId);
    const absolute = resolveWritePath(space, input.card.relativePath);
    const record: KnowledgeCardRecord = {
      ...input.card,
      spaceId: space.spaceId,
      updatedAt: this.overrides.now().getTime(),
    };
    await this.overrides.mkdir(path.dirname(absolute));
    await this.overrides.writeFile(absolute, serializeKnowledgeCard(record));
    await this.overrides.index?.rebuild();
    return record;
  }

  async promote(input: KnowledgePromoteInput): Promise<KnowledgeCardRecord> {
    assertHumanConfirmation(input.confirmation, input.permissionMode);
    const current = input.card.lifecycle;
    if (current === 'draft') {
      throw new KnowledgeLifecycleError('KNOWLEDGE_LIFECYCLE_INVALID: Draft cannot promote; create a Candidate first.');
    }
    if (input.to === 'verified' && current !== 'candidate' && current !== 'verified') {
      throw new KnowledgeLifecycleError(`KNOWLEDGE_LIFECYCLE_INVALID: cannot promote ${current} to verified.`);
    }
    if (input.to === 'promoted' && current !== 'verified' && current !== 'promoted') {
      throw new KnowledgeLifecycleError(`KNOWLEDGE_LIFECYCLE_INVALID: cannot promote ${current} to promoted.`);
    }
    if (input.to === 'verified' && input.card.type === 'case') {
      const missing = missingCaseChapters(input.card.chapters);
      if (missing.length > 0) {
        throw new KnowledgeLifecycleError(`KNOWLEDGE_LIFECYCLE_INVALID: case cannot be verified; missing chapters: ${missing.join(',')}`);
      }
    }
    return this.write({
      spaceId: input.spaceId,
      card: { ...input.card, lifecycle: input.to },
      permissionMode: input.permissionMode,
      confirmation: input.confirmation,
    });
  }
}

export const knowledgeWriteService = new KnowledgeWriteService({
  listSpaces: () => knowledgeQueryService.listSpaces(),
  writeFile: (filePath, contents) => fs.writeFile(filePath, contents, 'utf8'),
  mkdir: async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
  },
  index: knowledgeIndexService,
  now: () => new Date(),
});

