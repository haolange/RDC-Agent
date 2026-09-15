import { extname } from 'node:path';
import {
  KNOWLEDGE_IMAGE_ROLES,
  type KnowledgeImageRef,
  type KnowledgeImageRole,
} from '@shared/types/knowledge';
import { toPosixRelative } from './knowledgeFs';

export const KNOWLEDGE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export const KNOWLEDGE_IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export function knowledgeImageMime(relativePath: string): string | undefined {
  return KNOWLEDGE_IMAGE_MIME_BY_EXT[extname(relativePath).toLowerCase()];
}

export function isKnowledgeImageFileName(fileName: string): boolean {
  return KNOWLEDGE_IMAGE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

export function normalizeKnowledgeImagePath(relativePath: string): string {
  return toPosixRelative(relativePath).replace(/^\/+/, '');
}

export function knowledgeImageRoleFromAsset(role?: string): KnowledgeImageRole {
  const value = role?.trim().toLowerCase() ?? '';
  if (value === 'observed' || value === 'before' || value === 'symptom') return 'observed';
  if (value === 'reference' || value === 'after' || value === 'expected') return 'reference';
  return 'illustration';
}

export function knowledgeImageDestination(
  caseId: string,
  role: KnowledgeImageRole,
  fileName: string,
  used: Set<string>,
): string {
  const ext = extname(fileName).toLowerCase() || '.png';
  let dest = normalizeKnowledgeImagePath(`cases/${caseId}/${role}${ext}`);
  let index = 2;
  while (used.has(dest)) {
    dest = normalizeKnowledgeImagePath(`cases/${caseId}/${role}-${index}${ext}`);
    index += 1;
  }
  used.add(dest);
  return dest;
}

export function isSafeKnowledgeImageRelative(relativePath: string): boolean {
  const image = normalizeKnowledgeImagePath(relativePath);
  return Boolean(image && !image.includes('\0') && !image.split('/').includes('..') && isKnowledgeImageFileName(image));
}

export function isKnowledgeImagePathAllowed(
  cardRelativePath: string,
  imageRelativePath: string,
  caseId?: string,
): boolean {
  const image = normalizeKnowledgeImagePath(imageRelativePath);
  if (!image || image.includes('\0') || image.split('/').includes('..') || !isKnowledgeImageFileName(image)) {
    return false;
  }
  const cardDir = toPosixRelative(cardRelativePath).replace(/^\/+/, '').split('/').slice(0, -1).join('/');
  const sameDirFile = cardDir
    ? image.startsWith(`${cardDir}/`) && !image.slice(cardDir.length + 1).includes('/')
    : !image.includes('/');
  if (sameDirFile) return true;
  if (caseId) {
    const caseDir = normalizeKnowledgeImagePath(`cases/${caseId}`);
    return image === caseDir || image.startsWith(`${caseDir}/`);
  }
  return Boolean(cardDir && (image === cardDir || image.startsWith(`${cardDir}/`)));
}

export function sanitizeKnowledgeImages(
  images: readonly KnowledgeImageRef[] | undefined,
  cardRelativePath: string,
  caseId?: string,
): KnowledgeImageRef[] {
  if (!images?.length) return [];
  const seen = new Set<string>();
  const out: KnowledgeImageRef[] = [];
  for (const image of images) {
    const relativePath = normalizeKnowledgeImagePath(image.relativePath);
    if (seen.has(relativePath) || !isKnowledgeImagePathAllowed(cardRelativePath, relativePath, caseId)) continue;
    if (!KNOWLEDGE_IMAGE_ROLES.includes(image.role)) continue;
    seen.add(relativePath);
    out.push({
      relativePath,
      role: image.role,
      ...(image.alt?.trim() ? { alt: image.alt.trim() } : {}),
    });
  }
  return out;
}
