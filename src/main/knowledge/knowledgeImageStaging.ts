import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appPathService } from '../runtime/AppPathService';
import { assertSafeKnowledgeWriteTarget, toPosixRelative } from './knowledgeFs';
import type { KnowledgeStagedImage } from './knowledgeIngest';

export function knowledgeIngestStagingRoot(appStateRoot?: string): string {
  return path.join(appStateRoot ?? appPathService.getAppStatePaths().appStateRoot, 'knowledge-ingest');
}

function cardStagingDir(cardId: string, appStateRoot?: string): string {
  const digest = createHash('sha256').update(cardId, 'utf8').digest('hex').slice(0, 16);
  return path.join(knowledgeIngestStagingRoot(appStateRoot), digest);
}

export async function putStagedKnowledgeImages(
  cardId: string,
  images: readonly KnowledgeStagedImage[],
  appStateRoot?: string,
): Promise<void> {
  const root = cardStagingDir(cardId, appStateRoot);
  await fs.rm(root, { recursive: true, force: true });
  if (images.length === 0) return;
  for (const image of images) {
    const dest = await assertSafeKnowledgeWriteTarget(root, image.relativePath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, image.bytes);
  }
}

export async function takeStagedKnowledgeImages(
  cardId: string,
  relativePaths: readonly string[],
  appStateRoot?: string,
): Promise<KnowledgeStagedImage[]> {
  const root = cardStagingDir(cardId, appStateRoot);
  const out: KnowledgeStagedImage[] = [];
  for (const relativePath of relativePaths) {
    const dest = path.resolve(root, ...toPosixRelative(relativePath).replace(/^\/+/, '').split('/'));
    try {
      const bytes = await fs.readFile(dest);
      out.push({
        relativePath,
        role: 'illustration',
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    } catch {
      // not staged
    }
  }
  return out;
}

export async function clearStagedKnowledgeImages(cardId: string, appStateRoot?: string): Promise<void> {
  await fs.rm(cardStagingDir(cardId, appStateRoot), { recursive: true, force: true });
}
