import { promises as fs } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';
import {
  KNOWLEDGE_PACKAGE_SCHEMA,
  type KnowledgeExportRequest,
  type KnowledgeExportResult,
  type KnowledgePackage,
  type KnowledgePackageCard,
} from '@shared/types/knowledgeExport';
import { containsAbsolutePath, hasKnowledgeSecret } from './knowledgeIngest';

export interface KnowledgeExportDependencies {
  getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null>;
  listCards(spaceId: string): Promise<Array<{ spaceId: string; relativePath: string }>>;
  writeFile(targetPath: string, contents: string): Promise<void>;
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * Package cards carry authoring content only. Machine-local provenance never
 * leaves this machine, so a package cannot imply the target already verified it.
 */
export function toPackageCard(card: KnowledgeCardDetail): KnowledgePackageCard {
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
    images: card.images,
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
    let excludedCount = 0;
    for (const ref of refs) {
      const card = await this.deps.getCard(ref.spaceId, ref.relativePath);
      if (!card) continue;
      if (!isExportable(card)) {
        excludedCount += 1;
        continue;
      }
      cards.push(toPackageCard(card));
    }
    if (cards.length === 0) throw new Error('KNOWLEDGE_EXPORT_EMPTY_RESULT');

    const contents = request.format === 'package'
      ? serializePackage(cards, new Date().toISOString())
      : serializeMarkdown(cards);
    await this.deps.writeFile(request.targetPath, contents);
    return {
      cardCount: cards.length,
      excludedCount,
      bytes: Buffer.byteLength(contents, 'utf8'),
      targetPath: request.targetPath,
    };
  }
}

export function createDefaultExportDependencies(services: {
  getCard(spaceId: string, relativePath: string): Promise<KnowledgeCardDetail | null>;
  listCards(spaceId: string): Promise<Array<{ relativePath: string }>>;
}): KnowledgeExportDependencies {
  return {
    getCard: services.getCard,
    listCards: async (spaceId) => (await services.listCards(spaceId))
      .map((card) => ({ spaceId, relativePath: card.relativePath })),
    // Temp file plus rename so a cancelled or failed write leaves no half file.
    writeFile: async (targetPath, contents) => {
      const temp = `${targetPath}.tmp`;
      await fs.writeFile(temp, contents, 'utf8');
      await fs.rename(temp, targetPath);
    },
  };
}
