import { promises as fs } from 'node:fs';
import type { KnowledgeCardRecord, KnowledgeSpace } from '@shared/types/knowledge';
import { KnowledgeAssetsMissingError } from './knowledgeErrors';
import { resolveWithinRoot } from './knowledgeFs';
import { isKnowledgeImagePathAllowed, KNOWLEDGE_IMAGE_MAX_BYTES } from './knowledgeImages';

/** Check the authoritative space files, not renderer-provided image preview state. */
export async function assertKnowledgeImagesAvailable(
  card: KnowledgeCardRecord,
  spaces: KnowledgeSpace[],
  stagedPaths: readonly string[] = [],
): Promise<void> {
  if (!card.images?.length) return;
  const space = spaces.find((entry) => entry.spaceId === card.spaceId);
  if (!space) throw new KnowledgeAssetsMissingError();
  const staged = new Set(stagedPaths);
  for (const image of card.images) {
    if (!isKnowledgeImagePathAllowed(card.relativePath, image.relativePath, card.caseId)) {
      throw new KnowledgeAssetsMissingError();
    }
    if (staged.has(image.relativePath)) continue;
    try {
      const absolute = await resolveWithinRoot(space.rootPath, image.relativePath);
      const stat = await fs.stat(absolute);
      if (stat.isFile() && stat.size > 0 && stat.size <= KNOWLEDGE_IMAGE_MAX_BYTES) continue;
    } catch {
      // Missing, unreadable, or outside the owning space all leave the card a Draft.
    }
    throw new KnowledgeAssetsMissingError();
  }
}
