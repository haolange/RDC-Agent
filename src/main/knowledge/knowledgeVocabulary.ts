/**
 * Retrieval equivalences, independent of card type, lifecycle and Scope.
 * These terms change search only; they do not classify or rewrite any card.
 */
export interface KnowledgeSynonymGroup {
  terms: readonly string[];
}

export const BUILTIN_KNOWLEDGE_SYNONYMS: readonly KnowledgeSynonymGroup[] = [
  { terms: ['shader', '着色器'] },
  { terms: ['texture', '纹理'] },
  { terms: ['pixel', '像素'] },
  { terms: ['sampling', '采样'] },
  { terms: ['filtering', '过滤'] },
  { terms: ['precision', '精度'] },
  { terms: ['bandwidth', '带宽'] },
  { terms: ['memory', '内存'] },
];

const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
export const normalizeKnowledgeText = (value: string): string => value.normalize('NFKC').toLocaleLowerCase();

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

export function createKnowledgeTextMatcher(groups: readonly KnowledgeSynonymGroup[] = BUILTIN_KNOWLEDGE_SYNONYMS): (input: string, query: string) => boolean {
  const parent = groups.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : root(parent[index]);
  const first = new Map<string, number>();
  for (const [index, group] of groups.entries()) {
    for (const raw of group.terms) {
      const term = normalizeKnowledgeText(raw).trim();
      if (!term) continue;
      const previous = first.get(term);
      if (previous === undefined) first.set(term, index);
      else parent[root(index)] = root(previous);
    }
  }
  const aliases = [...first.keys()].sort((left, right) => right.length - left.length);
  const pattern = aliases.map(term => /^[a-z0-9_ ]+$/u.test(term)
    ? `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`
    : escapeRegExp(term)).join('|');
  const expression = pattern ? new RegExp(pattern, 'gu') : null;
  const fold = (value: string): string => {
    const text = normalizeKnowledgeText(value);
    return expression ? text.replace(expression, match => ` rdcsyngroup${root(first.get(match)!)} `) : text;
  };
  return (input, query) => {
    const haystack = fold(input);
    const words = [...segmenter.segment(fold(query))].filter(part => part.isWordLike).map(part => part.segment);
    return words.length > 0 && words.every(word => haystack.includes(word));
  };
}

export function knowledgeTextMatches(input: string, query: string, groups: readonly KnowledgeSynonymGroup[] = BUILTIN_KNOWLEDGE_SYNONYMS): boolean {
  return createKnowledgeTextMatcher(groups)(input, query);
}
