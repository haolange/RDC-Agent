import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { KnowledgeCardDetail, KnowledgeImageRef, KnowledgeSpace } from '@shared/types/knowledge';
import {
  KNOWLEDGE_PACKAGE_SCHEMA,
  type KnowledgeExportRequest,
  type KnowledgeExportResult,
  type KnowledgePackage,
  type KnowledgePackageCard,
} from '@shared/types/knowledgeExport';
import { resolveWithinRoot } from './knowledgeFs';
import { containsAbsolutePath, hasKnowledgeSecret } from './knowledgeIngest';
import { isSafeKnowledgeImageRelative, KNOWLEDGE_IMAGE_MAX_BYTES } from './knowledgeImages';
import {
  KNOWLEDGE_PACKAGE_MANIFEST,
  utf8ToZip,
  zipKnowledgeFiles,
} from './knowledgeZip';

export interface KnowledgeExportDependencies {
  getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null>;
  listCards(spaceId: string): Promise<Array<{ spaceId: string; relativePath: string }>>;
  readImage(spaceId: string, relativePath: string): Promise<Uint8Array | null>;
  writeBytes(targetPath: string, contents: Uint8Array): Promise<void>;
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * Package cards carry authoring content only. Machine-local provenance never
 * leaves this machine, so a package cannot imply the target already verified it.
 */
export function toPackageCard(card: KnowledgeCardDetail, images?: KnowledgeImageRef[]): KnowledgePackageCard {
  return omitUndefined({
    cardId: card.cardId,
    relativePath: card.relativePath,
    type: card.type ?? 'fact',
    lifecycle: card.lifecycle ?? 'draft',
    title: card.title,
    scope: card.scope,
    relations: card.relations,
    body: card.body,
    sourceStatus: card.sourceStatus,
    caseId: card.caseId,
    chapters: card.chapters,
    images,
  });
}

/** Reuses the import guard so an export can never carry out what import refuses in. */
export function isExportable(card: KnowledgeCardDetail): boolean {
  const texts = [card.title, card.body, card.caseId, card.sourceStatus, ...Object.values(card.chapters ?? {})];
  return !texts.some((text) => typeof text === 'string' && (hasKnowledgeSecret(text) || containsAbsolutePath(text)));
}

export function serializePackage(cards: KnowledgePackageCard[], exportedAt: string): string {
  const pack: KnowledgePackage = {
    schema: KNOWLEDGE_PACKAGE_SCHEMA,
    exportedAt,
    cards,
  };
  return stringifyYaml(pack, { lineWidth: 0 });
}

export function serializeMarkdown(cards: KnowledgePackageCard[]): string {
  return cards
    .map((card) => {
      const meta = [card.type, card.lifecycle, card.caseId].filter(Boolean).join(' · ');
      return [`# ${card.title}`, meta ? `> ${meta}` : '', card.body.trim()]
        .filter(Boolean)
        .join('\n\n');
    })
    .join('\n\n---\n\n')
    .concat('\n');
}

export class KnowledgeExportService {
  constructor(private readonly deps: KnowledgeExportDependencies) {}

  private async resolveRefs(
    request: KnowledgeExportRequest,
  ): Promise<Array<{ spaceId: string; relativePath: string }>> {
    if (request.scope === 'space') {
      if (!request.spaceId) throw new Error('KNOWLEDGE_EXPORT_SPACE_REQUIRED');
      return this.deps.listCards(request.spaceId);
    }
    if (!request.cardRefs?.length) throw new Error('KNOWLEDGE_EXPORT_EMPTY_SELECTION');
    return request.cardRefs;
  }

  async export(request: KnowledgeExportRequest): Promise<KnowledgeExportResult> {
    if (!path.isAbsolute(request.targetPath)) {
      throw new Error('KNOWLEDGE_EXPORT_TARGET_INVALID');
    }
    const refs = await this.resolveRefs(request);
    const cards: KnowledgePackageCard[] = [];
    const imageFiles = new Map<string, Uint8Array>();
    let excludedCount = 0;
    for (const ref of refs) {
      const card = await this.deps.getCard(ref.spaceId, ref.relativePath);
      if (!card) continue;
      if (!isExportable(card)) {
        excludedCount += 1;
        continue;
      }
      const present: KnowledgeImageRef[] = [];
      for (const image of card.images ?? []) {
        if (!isSafeKnowledgeImageRelative(image.relativePath)) continue;
        const bytes = await this.deps.readImage(card.spaceId, image.relativePath);
        if (!bytes || bytes.byteLength === 0 || bytes.byteLength > KNOWLEDGE_IMAGE_MAX_BYTES) continue;
        present.push(image);
        if (!imageFiles.has(image.relativePath)) imageFiles.set(image.relativePath, bytes);
      }
      cards.push(toPackageCard(card, present.length > 0 ? present : undefined));
    }
    if (cards.length === 0) throw new Error('KNOWLEDGE_EXPORT_EMPTY_RESULT');

    const payload = request.format === 'package'
      ? zipKnowledgeFiles([
        { name: KNOWLEDGE_PACKAGE_MANIFEST, data: utf8ToZip(serializePackage(cards, new Date().toISOString())) },
        ...[...imageFiles.entries()].map(([name, data]) => ({ name, data })),
      ])
      : new TextEncoder().encode(serializeMarkdown(cards));
    await this.deps.writeBytes(request.targetPath, payload);
    return {
      cardCount: cards.length,
      excludedCount,
      bytes: payload.byteLength,
      targetPath: request.targetPath,
    };
  }
}

export function createDefaultExportDependencies(services: {
  getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null>;
  listCards(spaceId: string): Promise<Array<{ relativePath: string }>>;
  listSpaces(): KnowledgeSpace[];
}): KnowledgeExportDependencies {
  return {
    getCard: services.getCard,
    listCards: async (spaceId) => (await services.listCards(spaceId))
      .map((card) => ({ spaceId, relativePath: card.relativePath })),
    readImage: async (spaceId, relativePath) => {
      const space = services.listSpaces().find((entry) => entry.spaceId === spaceId);
      if (!space) return null;
      try {
        const absolute = await resolveWithinRoot(space.rootPath, relativePath);
        return await fs.readFile(absolute);
      } catch {
        return null;
      }
    },
    writeBytes: async (targetPath, contents) => {
      const temp = `${targetPath}.tmp`;
      await fs.writeFile(temp, contents);
      await fs.rename(temp, targetPath);
    },
  };
}
