import type { KnowledgeImportResult, KnowledgeLaneHit } from '@shared/types/knowledge';

export function beginSynchronousFlight(flag: { current: boolean }): boolean {
  if (flag.current) return false;
  flag.current = true;
  return true;
}

export function firstImportedSpaceCard(result: KnowledgeImportResult): {
  spaceId: string;
  relativePath: string;
  cardId: string;
} | null {
  const record = result.items.find((item) => item.status === 'draft' && item.record)?.record;
  if (!record) return null;
  return {
    spaceId: record.spaceId,
    relativePath: record.relativePath,
    cardId: record.cardId,
  };
}

export function knowledgeExportScopeCounts(input: {
  selected: { spaceId: string; relativePath: string } | null;
  hits: readonly KnowledgeLaneHit[];
  spaceCount: number;
}): { selected: number; filtered: number; space: number } {
  return {
    selected: input.selected ? 1 : 0,
    filtered: input.hits.length,
    space: input.spaceCount,
  };
}
