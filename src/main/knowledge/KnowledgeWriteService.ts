import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import { missingCaseChapters, serializeKnowledgeCard } from './knowledgeCardSchema';
import { assertKnowledgeImagesAvailable } from './knowledgeAssetAvailability';
import { knowledgeHumanConfirmationRequired, knowledgeAssetsMissing } from './knowledgeErrors';
import { assertSafeKnowledgeWriteTarget, writeKnowledgeCardAtomic } from './knowledgeFs';
import { clearStagedKnowledgeImages, putStagedKnowledgeImages, takeStagedKnowledgeImages } from './knowledgeImageStaging';
import { isKnowledgeImagePathAllowed } from './knowledgeImages';
import { knowledgeIndexService, KnowledgeIndexService } from './KnowledgeIndexService';
import { knowledgeQueryService } from './KnowledgeQueryService';
import type { KnowledgeStagedImage } from './knowledgeIngest';
import type { AgentPermissionMode } from '@shared/types/settings';
import type { KnowledgeCardRecord, KnowledgeHumanConfirmation, KnowledgeLifecycle, KnowledgeSpace } from '@shared/types/knowledge';

export interface KnowledgeWriteInput {
  spaceId: string;
  card: KnowledgeCardRecord;
  permissionMode: AgentPermissionMode;
  confirmation: KnowledgeHumanConfirmation;
  stagedImages?: KnowledgeStagedImage[];
}

export interface KnowledgePromoteInput {
  spaceId: string;
  card: KnowledgeCardRecord;
  to: Extract<KnowledgeLifecycle, 'verified' | 'promoted' | 'retired'>;
  permissionMode: AgentPermissionMode;
  confirmation: KnowledgeHumanConfirmation;
}

export interface KnowledgeWriteDependencies {
  listSpaces(): KnowledgeSpace[];
  writeFile?(filePath: string, contents: string): Promise<void>;
  mkdir?(dirPath: string): Promise<void>;
  index?: KnowledgeIndexService;
  now(): Date;
}

function assertHumanConfirmation(
  confirmation: KnowledgeHumanConfirmation | undefined,
  permissionMode: AgentPermissionMode,
): void {
  if (confirmation?.explicitHumanConfirmation !== true) {
    throw knowledgeHumanConfirmationRequired(permissionMode);
  }
}

function resolveSpace(spaces: KnowledgeSpace[], spaceId: string): KnowledgeSpace {
  const space = spaces.find((entry) => entry.spaceId === spaceId);
  if (!space) throw new Error(`Unknown knowledge space: ${spaceId}`);
  return space;
}

function assertFixedIsNotVerified(card: KnowledgeCardRecord, to?: KnowledgeLifecycle): void {
  const becomingVerified = card.lifecycle === 'verified' || to === 'verified';
  if (becomingVerified && card.sourceStatus === 'fixed') {
    throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', 'sourceStatus=fixed is not verified.');
  }
}

export class KnowledgeWriteService {
  constructor(private readonly overrides: KnowledgeWriteDependencies) {}

  async write(input: KnowledgeWriteInput): Promise<KnowledgeCardRecord> {
    assertHumanConfirmation(input.confirmation, input.permissionMode);
    if (input.card.lifecycle === 'candidate') {
      throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', 'persist Candidate via KnowledgeCandidateService, not Write.');
    }
    assertFixedIsNotVerified(input.card);
    if ((input.card.lifecycle === 'verified' || input.card.lifecycle === 'promoted') && input.card.missingAssets?.length) {
      throw knowledgeAssetsMissing();
    }
    if (input.card.lifecycle === 'verified' && input.card.type === 'case') {
      const missing = missingCaseChapters(input.card.chapters);
      if (missing.length > 0) {
        throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', `case cannot be verified; missing chapters: ${missing.join(',')}`);
      }
    }
    if ((input.card.lifecycle === 'verified' || input.card.lifecycle === 'promoted') && input.card.images?.length) {
      await assertKnowledgeImagesAvailable(
        input.card,
        this.overrides.listSpaces(),
        input.stagedImages?.map((image) => image.relativePath),
      );
    }
    const space = resolveSpace(this.overrides.listSpaces(), input.spaceId);
    const absolute = await assertSafeKnowledgeWriteTarget(space.rootPath, input.card.relativePath);
    const record: KnowledgeCardRecord = {
      ...input.card,
      spaceId: space.spaceId,
      updatedAt: this.overrides.now().getTime(),
    };
    const serialized = serializeKnowledgeCard(record);
    const parent = path.dirname(absolute);
    if (this.overrides.mkdir) await this.overrides.mkdir(parent);
    else await fs.mkdir(parent, { recursive: true });
    if (this.overrides.writeFile) {
      await this.overrides.writeFile(absolute, serialized);
      const written = await fs.readFile(absolute, 'utf8');
      const expected = createHash('sha256').update(serialized, 'utf8').digest('hex');
      const actual = createHash('sha256').update(written, 'utf8').digest('hex');
      if (expected !== actual) {
        throw new AppError('KNOWLEDGE_WRITE_INTEGRITY', `post-write hash mismatch for ${absolute}.`);
      }
    } else {
      await writeKnowledgeCardAtomic(absolute, serialized);
    }
    await this.writeStagedImages(space.rootPath, record, input.stagedImages);
    await this.overrides.index?.rebuild();
    return record;
  }

  private async writeStagedImages(
    rootPath: string,
    record: KnowledgeCardRecord,
    incoming?: KnowledgeStagedImage[],
  ): Promise<void> {
    const declared = record.images ?? [];
    if (declared.length === 0) return;
    if (incoming?.length) await putStagedKnowledgeImages(record.cardId, incoming);
    const staged = await takeStagedKnowledgeImages(record.cardId, declared.map((image) => image.relativePath));
    for (const image of staged) {
      if (!isKnowledgeImagePathAllowed(record.relativePath, image.relativePath, record.caseId)) continue;
      const dest = await assertSafeKnowledgeWriteTarget(rootPath, image.relativePath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, image.bytes);
    }
    await clearStagedKnowledgeImages(record.cardId);
  }

  async promote(input: KnowledgePromoteInput): Promise<KnowledgeCardRecord> {
    assertHumanConfirmation(input.confirmation, input.permissionMode);
    assertFixedIsNotVerified(input.card, input.to);
    const current = input.card.lifecycle;
    if (current === 'draft') {
      throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', 'Draft cannot promote; create a Candidate first.');
    }
    if (input.to === 'verified' && current !== 'candidate' && current !== 'verified') {
      throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', `cannot promote ${current} to verified.`);
    }
    if (input.to === 'promoted' && current !== 'verified' && current !== 'promoted') {
      throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', `cannot promote ${current} to promoted.`);
    }
    if (input.to === 'verified' && input.card.type === 'case') {
      const missing = missingCaseChapters(input.card.chapters);
      if (missing.length > 0) {
        throw new AppError('KNOWLEDGE_LIFECYCLE_INVALID', `case cannot be verified; missing chapters: ${missing.join(',')}`);
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
  index: knowledgeIndexService,
  now: () => new Date(),
});
