import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { KnowledgeCardRecord, KnowledgeHumanConfirmation, KnowledgeLifecycle, KnowledgeSpace } from '@shared/types/knowledge';
import type { AgentPermissionMode } from '@shared/types/settings';
import { missingCaseChapters, serializeKnowledgeCard } from './knowledgeCardSchema';
import {
  KnowledgeApprovalTokenInvalidError,
  KnowledgeHumanConfirmationRequiredError,
  KnowledgeLifecycleError,
  KnowledgeWriteIntegrityError,
} from './knowledgeErrors';
import { assertSafeKnowledgeWriteTarget, writeKnowledgeCardAtomic } from './knowledgeFs';
import { clearStagedKnowledgeImages, putStagedKnowledgeImages, takeStagedKnowledgeImages } from './knowledgeImageStaging';
import { isKnowledgeImagePathAllowed } from './knowledgeImages';
import type { KnowledgeStagedImage } from './knowledgeIngest';
import { knowledgeIndexService, KnowledgeIndexService } from './KnowledgeIndexService';
import { knowledgeQueryService } from './KnowledgeQueryService';

export interface KnowledgeWriteInput {
  spaceId: string;
  card: KnowledgeCardRecord;
  permissionMode: AgentPermissionMode;
  confirmation: KnowledgeHumanConfirmation;
  approvalToken?: string;
  approvalAlreadyConsumed?: boolean;
  stagedImages?: KnowledgeStagedImage[];
}

export interface KnowledgePromoteInput {
  spaceId: string;
  card: KnowledgeCardRecord;
  to: Extract<KnowledgeLifecycle, 'verified' | 'promoted' | 'deprecated'>;
  permissionMode: AgentPermissionMode;
  confirmation: KnowledgeHumanConfirmation;
  approvalToken?: string;
}

export interface KnowledgeWriteDependencies {
  listSpaces(): KnowledgeSpace[];
  writeFile?(filePath: string, contents: string): Promise<void>;
  mkdir?(dirPath: string): Promise<void>;
  index?: KnowledgeIndexService;
  now(): Date;
  consumeApprovalToken?(token: string, action: 'knowledge.write' | 'knowledge.promote'): boolean;
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

function assertFixedIsNotVerified(card: KnowledgeCardRecord, to?: KnowledgeLifecycle): void {
  const becomingVerified = card.lifecycle === 'verified' || to === 'verified';
  if (becomingVerified && card.sourceStatus === 'fixed') {
    throw new KnowledgeLifecycleError('KNOWLEDGE_LIFECYCLE_INVALID: sourceStatus=fixed is not verified.');
  }
}

export class KnowledgeWriteService {
  constructor(private readonly overrides: KnowledgeWriteDependencies) {}

  async write(input: KnowledgeWriteInput): Promise<KnowledgeCardRecord> {
    assertHumanConfirmation(input.confirmation, input.permissionMode);
    if (!input.approvalAlreadyConsumed) {
      this.consumeToken(input.approvalToken, 'knowledge.write');
    }
    if (input.card.lifecycle === 'candidate') {
      throw new KnowledgeLifecycleError('KNOWLEDGE_LIFECYCLE_INVALID: persist Candidate via KnowledgeCandidateService, not Write.');
    }
    assertFixedIsNotVerified(input.card);
    if (input.card.lifecycle === 'verified' && input.card.type === 'case') {
      const missing = missingCaseChapters(input.card.chapters);
      if (missing.length > 0) {
        throw new KnowledgeLifecycleError(`KNOWLEDGE_LIFECYCLE_INVALID: case cannot be verified; missing chapters: ${missing.join(',')}`);
      }
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
        throw new KnowledgeWriteIntegrityError(`post-write hash mismatch for ${absolute}.`);
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
    this.consumeToken(input.approvalToken, 'knowledge.promote');
    assertFixedIsNotVerified(input.card, input.to);
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
      approvalAlreadyConsumed: true,
    });
  }

  private consumeToken(
    token: string | undefined,
    action: 'knowledge.write' | 'knowledge.promote',
  ): void {
    if (!this.overrides.consumeApprovalToken) return;
    if (!token || this.overrides.consumeApprovalToken(token, action) !== true) {
      throw new KnowledgeApprovalTokenInvalidError();
    }
  }
}

export const knowledgeWriteService = new KnowledgeWriteService({
  listSpaces: () => knowledgeQueryService.listSpaces(),
  index: knowledgeIndexService,
  now: () => new Date(),
});
