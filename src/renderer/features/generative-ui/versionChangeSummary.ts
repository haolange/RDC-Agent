import type { GenerativeUiSource, GenerativeUiVersion } from '@shared/types/generativeUi';

export interface SourceChangeSummary { added: number; removed: number; samples: Array<{ kind: 'added' | 'removed'; text: string }> }

const lineCounts = (value: string): Map<string, number> => value.split(/\r?\n/).reduce((counts, line) => {
  const normalized = line.trim();
  if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  return counts;
}, new Map<string, number>());

export function summarizeSourceChange(previous: string, current: string): SourceChangeSummary {
  const before = lineCounts(previous);
  const after = lineCounts(current);
  const samples: SourceChangeSummary['samples'] = [];
  let added = 0;
  let removed = 0;
  for (const [line, count] of after) {
    const delta = Math.max(0, count - (before.get(line) ?? 0));
    added += delta;
    if (delta && samples.length < 6) samples.push({ kind: 'added', text: line });
  }
  for (const [line, count] of before) {
    const delta = Math.max(0, count - (after.get(line) ?? 0));
    removed += delta;
    if (delta && samples.length < 6) samples.push({ kind: 'removed', text: line });
  }
  return { added, removed, samples };
}

export const summarizeVersionChanges = (version: GenerativeUiVersion, parent?: GenerativeUiVersion) => ({
  source: (['html', 'css', 'javascript'] as Array<keyof GenerativeUiSource>).map((kind) => ({
    kind, ...summarizeSourceChange(parent?.source[kind] ?? '', version.source[kind]),
  })),
  components: {
    added: version.spec.components.filter((entry) => !parent?.spec.components.some((candidate) => candidate.id === entry.id)).map((entry) => entry.id),
    removed: (parent?.spec.components ?? []).filter((entry) => !version.spec.components.some((candidate) => candidate.id === entry.id)).map((entry) => entry.id),
  },
  interactions: {
    added: version.spec.interactions.filter((entry) => !parent?.spec.interactions.some((candidate) => candidate.trigger === entry.trigger && candidate.effect === entry.effect)).map((entry) => entry.trigger),
    removed: (parent?.spec.interactions ?? []).filter((entry) => !version.spec.interactions.some((candidate) => candidate.trigger === entry.trigger && candidate.effect === entry.effect)).map((entry) => entry.trigger),
  },
});
