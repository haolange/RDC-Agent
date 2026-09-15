import { promises as fs } from 'node:fs';
import { NATIVE_IMAGE_MIME_TYPES } from '../conversation/attachmentClassify';
import { readAttachmentFilePreviewDataUrl } from '../conversation/attachmentPreview';
import type { KnowledgeSpace } from '@shared/types/knowledge';
import { resolveWithinRoot } from './knowledgeFs';
import { isSafeKnowledgeImageRelative, knowledgeImageMime } from './knowledgeImages';

export const KNOWLEDGE_IMAGE_MISSING = 'KNOWLEDGE_IMAGE_MISSING';
export const KNOWLEDGE_IMAGE_DENIED = 'KNOWLEDGE_IMAGE_DENIED';

export async function readKnowledgeImagePreview(input: {
  spaces: KnowledgeSpace[];
  spaceId: string;
  relativePath: string;
}): Promise<{ dataUrl: string | null; error?: string }> {
  const space = input.spaces.find((entry) => entry.spaceId === input.spaceId);
  if (!space) return { dataUrl: null, error: KNOWLEDGE_IMAGE_DENIED };
  if (!isSafeKnowledgeImageRelative(input.relativePath)) {
    return { dataUrl: null, error: KNOWLEDGE_IMAGE_DENIED };
  }
  const mimeType = knowledgeImageMime(input.relativePath);
  if (!mimeType || !NATIVE_IMAGE_MIME_TYPES.has(mimeType)) {
    return { dataUrl: null, error: KNOWLEDGE_IMAGE_DENIED };
  }
  try {
    const absolute = await resolveWithinRoot(space.rootPath, input.relativePath);
    await fs.stat(absolute);
    const dataUrl = readAttachmentFilePreviewDataUrl(absolute, mimeType);
    if (!dataUrl) return { dataUrl: null, error: KNOWLEDGE_IMAGE_MISSING };
    return { dataUrl };
  } catch {
    return { dataUrl: null, error: KNOWLEDGE_IMAGE_MISSING };
  }
}
