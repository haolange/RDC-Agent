import type { KnowledgeImportItem, KnowledgeImportResult, KnowledgeLaneHit } from '@shared/types/knowledge';

/** What an import does with one item, in the words the dialog uses. */
export type KnowledgeImportOutcome = 'new' | 'present' | 'conflict' | 'quarantine';

export function knowledgeImportOutcome(item: KnowledgeImportItem): KnowledgeImportOutcome {
  if (item.status === 'quarantine') return 'quarantine';
  if (item.status === 'conflict') return 'conflict';
  return item.reason === 'already-present' ? 'present' : 'new';
}

export function countKnowledgeImportOutcomes(items: readonly KnowledgeImportItem[]): Record<KnowledgeImportOutcome, number> {
  const counts: Record<KnowledgeImportOutcome, number> = { new: 0, present: 0, conflict: 0, quarantine: 0 };
  for (const item of items) counts[knowledgeImportOutcome(item)] += 1;
  return counts;
}

/** Why a source was held back, from the ingest's reason codes; an unlisted reason reads as the general one. */
export const KNOWLEDGE_QUARANTINE_REASONS = [
  'absolute-path', 'filename-leaked', 'secret-detected', 'source-changed', 'source-too-large', 'source-unreadable',
  'yaml-broken', 'zip-invalid', 'zip-path-invalid',
] as const;
export type KnowledgeQuarantineReason = (typeof KNOWLEDGE_QUARANTINE_REASONS)[number];

export const knowledgeQuarantineReason = (reason: string | undefined): KnowledgeQuarantineReason | null => (
  KNOWLEDGE_QUARANTINE_REASONS.find((known) => known === reason) ?? null
);

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
  picked: number;
  hits: readonly KnowledgeLaneHit[];
  filteredCount?: number;
  spaceCount: number;
}): { selected: number; filtered: number; space: number } {
  return {
    selected: input.picked,
    filtered: input.filteredCount ?? input.hits.length,
    space: input.spaceCount,
  };
}

/** The stable key of a card in the export picker. */
export const knowledgeCardKey = (card: { spaceId: string; relativePath: string }): string => `${card.spaceId}\u0000${card.relativePath}`;

/** Cards in the picker whose title matches the search, case-insensitively; an empty search keeps them all. */
export function filterPickableCards<T extends { title: string }>(cards: readonly T[], query: string): T[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle ? cards.filter((card) => card.title.toLocaleLowerCase().includes(needle)) : [...cards];
}
