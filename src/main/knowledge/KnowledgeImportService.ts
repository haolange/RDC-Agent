import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StorageIo } from '../sessions/store/StorageIo';
import { KnowledgeDraftMigrationConflictError } from './knowledgeErrors';
import {
  hashKnowledgeImportBytes,
  ingestKnowledge,
  ingestKnowledgeFromPath,
  type KnowledgeImportPathResult,
  type KnowledgeStagedImage,
} from './knowledgeIngest';
import {
  createSessionScopedKnowledgeStore,
  knowledgeDurableStore,
  type KnowledgeDurableStore,
} from './KnowledgeDurableStore';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import { KnowledgeQueryService, knowledgeQueryService } from './KnowledgeQueryService';
import { knowledgeWriteService, KnowledgeWriteService } from './KnowledgeWriteService';
import type { KnowledgeDurableDraft } from './knowledgeStateSchema';
import type {
  KnowledgeCardDetail,
  KnowledgeCardRecord,
  KnowledgeCardSummary,
  KnowledgeImportItem,
  KnowledgeImportResult,
  KnowledgeSpace,
} from '@shared/types/knowledge';

export interface KnowledgeSpaceOccupant {
  cardId: string;
  spaceId: string;
  relativePath: string;
  title: string;
  caseId?: string;
  sourceHash?: string;
}

export interface KnowledgeImportRequest {
  spaceId: string;
  source?: string;
  filePath?: string;
  availableAssetNames?: Iterable<string>;
  availableImagePaths?: Iterable<string>;
}

/** What an import would do with one item, decided before anything is written. */
export interface PlannedKnowledgeImportItem {
  item: KnowledgeImportItem;
  /** Present only for a new card the import writes as a draft. */
  write?: { card: KnowledgeCardRecord; stagedImages?: KnowledgeStagedImage[] };
}

export interface KnowledgeImportDependencies {
  listSpaces(): KnowledgeSpace[];
  listCards(spaceId: string): Promise<KnowledgeCardSummary[]>;
  getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null>;
  write: KnowledgeWriteService;
  store: KnowledgeDurableStore;
}

function occupantMatches(record: KnowledgeCardRecord, occupant: KnowledgeSpaceOccupant): boolean {
  if (occupant.cardId === record.cardId) return true;
  return Boolean(record.caseId && occupant.caseId && record.caseId === occupant.caseId);
}

function sourceHashOf(item: KnowledgeImportItem, result: KnowledgeImportResult): string | undefined {
  return item.record?.sourceHash ?? result.sourceHash;
}

function attachInlineSourceHash(
  result: KnowledgeImportPathResult,
  source: string,
): KnowledgeImportPathResult {
  if (result.sourceHash) return result;
  const bytes = Buffer.from(source, 'utf8');
  const sourceHash = hashKnowledgeImportBytes(bytes);
  const sourceSize = bytes.length;
  for (const item of result.items) {
    if (item.record) {
      item.record.sourceHash = sourceHash;
      item.record.sourceSize = sourceSize;
    }
  }
  return { ...result, sourceHash, sourceSize };
}

/** The result a caller sees: the ingested source facts with the planned or written items, never staged bytes. */
function publicResult(ingested: KnowledgeImportPathResult, items: KnowledgeImportItem[]): KnowledgeImportResult {
  const { stagedImagesByCardId: _staged, ...source } = ingested;
  return { ...source, items };
}

function sameSource(occupant: KnowledgeSpaceOccupant, hash: string | undefined): boolean {
  return Boolean(hash && occupant.sourceHash && occupant.sourceHash === hash);
}

function alreadyPresentItem(
  item: KnowledgeImportItem,
  occupant: KnowledgeSpaceOccupant,
): KnowledgeImportItem {
  const record = item.record;
  return {
    status: 'draft',
    lifecycle: 'draft',
    missingAssets: item.missingAssets,
    reason: 'already-present',
    existingCardId: occupant.cardId,
    ...(occupant.caseId ? { existingCaseId: occupant.caseId } : {}),
    ...(item.sourceStatus ? { sourceStatus: item.sourceStatus } : {}),
    record: record
      ? {
        ...record,
        cardId: occupant.cardId,
        relativePath: occupant.relativePath,
        title: occupant.title,
        ...(occupant.caseId ? { caseId: occupant.caseId } : {}),
        ...(occupant.sourceHash ? { sourceHash: occupant.sourceHash } : {}),
      }
      : {
        cardId: occupant.cardId,
        spaceId: occupant.spaceId,
        relativePath: occupant.relativePath,
        type: 'case',
        lifecycle: 'draft',
        title: occupant.title,
        scope: {},
        relations: [],
        body: '',
        preview: occupant.title,
        ...(occupant.caseId ? { caseId: occupant.caseId } : {}),
      },
  };
}

function spaceConflictItem(
  item: KnowledgeImportItem,
  occupant: KnowledgeSpaceOccupant,
): KnowledgeImportItem {
  const title = item.record?.title || occupant.title;
  return {
    status: 'conflict',
    lifecycle: 'draft',
    missingAssets: item.missingAssets,
    reason: 'duplicate-case-id',
    existingCardId: occupant.cardId,
    ...(occupant.caseId ? { existingCaseId: occupant.caseId } : {}),
    ...(item.sourceStatus ? { sourceStatus: item.sourceStatus } : {}),
    record: {
      cardId: occupant.cardId,
      spaceId: occupant.spaceId,
      relativePath: occupant.relativePath,
      type: item.record?.type ?? 'case',
      lifecycle: 'draft',
      title,
      scope: item.record?.scope ?? {},
      relations: [],
      body: item.record?.body ?? '',
      preview: title,
      ...(occupant.caseId ? { caseId: occupant.caseId } : {}),
    },
  };
}

/**
 * The one judgment of an import against a space: quarantined items stay as they are, an item whose identity is
 * already in the space is either the same source (already present) or a different one (conflict), and every other
 * card is new. New cards become occupants as they are planned, so a package cannot add the same identity twice.
 * Preview and import both use this; only import then writes the planned cards.
 */
export function planKnowledgeImport(
  spaceId: string,
  ingested: KnowledgeImportPathResult,
  occupants: readonly KnowledgeSpaceOccupant[],
): PlannedKnowledgeImportItem[] {
  const known = [...occupants];
  return ingested.items.map((item) => {
    if (item.status !== 'draft' || !item.record) return { item };
    const occupant = known.find((entry) => occupantMatches(item.record!, entry));
    if (occupant && sameSource(occupant, sourceHashOf(item, ingested))) return { item: alreadyPresentItem(item, occupant) };
    if (occupant) return { item: spaceConflictItem(item, occupant) };
    const card: KnowledgeCardRecord = { ...item.record, spaceId, lifecycle: 'draft' };
    known.push({
      cardId: card.cardId,
      spaceId,
      relativePath: card.relativePath,
      title: card.title,
      ...(card.caseId ? { caseId: card.caseId } : {}),
      ...(card.sourceHash ? { sourceHash: card.sourceHash } : {}),
    });
    const stagedImages = ingested.stagedImagesByCardId?.get(item.record.cardId);
    return { item: { ...item, record: card }, write: { card, ...(stagedImages?.length ? { stagedImages } : {}) } };
  });
}

export class KnowledgeImportService {
  constructor(private readonly overrides: Partial<KnowledgeImportDependencies> = {}) {}

  private get deps(): KnowledgeImportDependencies {
    return {
      listSpaces: this.overrides.listSpaces ?? (() => knowledgeQueryService.listSpaces()),
      listCards: this.overrides.listCards ?? ((spaceId) => knowledgeQueryService.listCards(spaceId)),
      getCard: this.overrides.getCard ?? ((spaceId, relativePath) => knowledgeQueryService.getCard(spaceId, relativePath)),
      write: this.overrides.write ?? knowledgeWriteService,
      store: this.overrides.store ?? knowledgeDurableStore,
    };
  }

  /** What importing this source into the space would do, item by item. Nothing is written. */
  async previewImport(request: KnowledgeImportRequest): Promise<KnowledgeImportResult> {
    const ingested = await this.ingest(request);
    const planned = planKnowledgeImport(request.spaceId, ingested, await this.listOccupants(request.spaceId));
    return publicResult(ingested, planned.map((entry) => entry.item));
  }

  /**
   * Import writes draft cards into the chosen space. This method never creates a Candidate.
   */
  async importToSpace(request: KnowledgeImportRequest): Promise<KnowledgeImportResult> {
    const ingested = await this.ingest(request);
    const planned = planKnowledgeImport(request.spaceId, ingested, await this.listOccupants(request.spaceId));
    const items: KnowledgeImportItem[] = [];
    for (const entry of planned) {
      if (!entry.write) {
        items.push(entry.item);
        continue;
      }
      const written = await this.deps.write.write({
        spaceId: request.spaceId,
        card: entry.write.card,
        permissionMode: 'default',
        confirmation: { explicitHumanConfirmation: true },
        approvalAlreadyConsumed: true,
        ...(entry.write.stagedImages ? { stagedImages: entry.write.stagedImages } : {}),
      });
      items.push({ ...entry.item, record: written });
    }
    return publicResult(ingested, items);
  }

  private async ingest(request: KnowledgeImportRequest): Promise<KnowledgeImportPathResult> {
    const space = this.deps.listSpaces().find((entry) => entry.spaceId === request.spaceId);
    if (!space) {
      const error = new Error(`Unknown knowledge space: ${request.spaceId}`);
      (error as Error & { code: string }).code = 'KNOWLEDGE_SPACE_UNKNOWN';
      throw error;
    }
    return request.filePath
      ? await ingestKnowledgeFromPath(request.filePath, {
        spaceId: request.spaceId,
        ...(request.availableAssetNames ? { availableAssetNames: request.availableAssetNames } : {}),
        ...(request.availableImagePaths ? { availableImagePaths: request.availableImagePaths } : {}),
      })
      : attachInlineSourceHash(ingestKnowledge(request.source ?? '', {
        spaceId: request.spaceId,
        ...(request.availableAssetNames ? { availableAssetNames: request.availableAssetNames } : {}),
        ...(request.availableImagePaths ? { availableImagePaths: request.availableImagePaths } : {}),
      }) as KnowledgeImportPathResult, request.source ?? '');
  }

  async migrateSessionDrafts(sessionId: string): Promise<void> {
    const leftovers = await this.deps.store.listLeftoverDrafts(sessionId);
    if (leftovers.length === 0) return;
    const remaining: KnowledgeDurableDraft[] = [];
    const conflicts: string[] = [];
    for (const draft of leftovers) {
      const spaceId = draft.card.spaceId;
      const occupants = await this.listOccupants(spaceId);
      const occupant = occupants.find((entry) => occupantMatches(draft.card, entry));
      const hash = draft.sourceHash ?? draft.card.sourceHash;
      if (occupant && sameSource(occupant, hash)) continue;
      if (occupant) {
        remaining.push(draft);
        conflicts.push(occupant.cardId);
        continue;
      }
      await this.deps.write.write({
        spaceId,
        card: {
          ...draft.card,
          lifecycle: 'draft',
          spaceId,
          ...(draft.sourceHash ? { sourceHash: draft.sourceHash } : {}),
        },
        permissionMode: 'default',
        confirmation: { explicitHumanConfirmation: true },
        approvalAlreadyConsumed: true,
      });
    }
    await this.deps.store.replaceLeftoverDrafts(sessionId, remaining);
    if (conflicts.length > 0) {
      throw new KnowledgeDraftMigrationConflictError(conflicts);
    }
  }

  private async listOccupants(spaceId: string): Promise<KnowledgeSpaceOccupant[]> {
    if (!this.deps.listSpaces().some((entry) => entry.spaceId === spaceId)) return [];
    const summaries = await this.deps.listCards(spaceId);
    const occupants: KnowledgeSpaceOccupant[] = [];
    for (const summary of summaries) {
      const detail = await this.deps.getCard(spaceId, summary.relativePath);
      occupants.push({
        cardId: summary.cardId,
        spaceId,
        relativePath: summary.relativePath,
        title: summary.title,
        ...(detail?.caseId ? { caseId: detail.caseId } : {}),
        ...(detail?.sourceHash ? { sourceHash: detail.sourceHash } : {}),
      });
    }
    return occupants;
  }
}

export function createDisposableImportService(options: {
  spaceRoot: string;
  sessionRoot?: string;
  write?: KnowledgeWriteService;
}): KnowledgeImportService {
  const space: KnowledgeSpace = {
    spaceId: 'user',
    kind: 'user',
    label: 'User',
    rootPath: options.spaceRoot,
  };
  const io = {
    readFile: (filePath: string) => fs.readFile(filePath, 'utf8'),
    statMtime: async (filePath: string) => Math.trunc((await fs.stat(filePath)).mtimeMs),
  };
  const query = new KnowledgeQueryService({
    listSpaces: () => [space],
    index: new KnowledgeIndexService({
      listSpaces: () => [space],
      snapshotPath: () => path.join(options.spaceRoot, 'knowledge-index.json'),
      storage: new StorageIo(),
      now: () => new Date(),
      ...io,
    }),
    ...io,
  });
  const write = options.write ?? new KnowledgeWriteService({
    listSpaces: () => [space],
    now: () => new Date(),
  });
  return new KnowledgeImportService({
    listSpaces: () => [space],
    listCards: (spaceId) => query.listCards(spaceId),
    getCard: (spaceId, relativePath) => query.getCard(spaceId, relativePath),
    write,
    ...(options.sessionRoot ? { store: createSessionScopedKnowledgeStore(options.sessionRoot) } : {}),
  });
}

export const knowledgeImportService = new KnowledgeImportService();
