import type { KnowledgeImageRef, KnowledgeImageRole } from '@shared/types/knowledge';

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)$/i;

export function normalizeKnowledgePreviewPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '');
}

export function isSafeKnowledgePreviewPath(relativePath: string): boolean {
  const image = normalizeKnowledgePreviewPath(relativePath);
  return Boolean(image && !image.includes('\0') && !image.split('/').includes('..') && IMAGE_EXT.test(image));
}

export function groupKnowledgeImages(images: readonly KnowledgeImageRef[]): {
  pairs: Array<{ observed: KnowledgeImageRef; reference: KnowledgeImageRef }>;
  singles: KnowledgeImageRef[];
} {
  const observed = images.filter((image) => image.role === 'observed');
  const reference = images.filter((image) => image.role === 'reference');
  const leftover: KnowledgeImageRef[] = images.filter((image) => image.role === 'illustration');
  const pairs: Array<{ observed: KnowledgeImageRef; reference: KnowledgeImageRef }> = [];
  const pairCount = Math.min(observed.length, reference.length);
  for (let index = 0; index < pairCount; index += 1) {
    const left = observed[index];
    const right = reference[index];
    if (left && right) pairs.push({ observed: left, reference: right });
  }
  leftover.push(...observed.slice(pairCount), ...reference.slice(pairCount));
  return { pairs, singles: leftover };
}

export function knowledgeImageRoleLabelKey(role: KnowledgeImageRole): `knowledgeCenter.imageRole.${KnowledgeImageRole}` {
  return `knowledgeCenter.imageRole.${role}`;
}
