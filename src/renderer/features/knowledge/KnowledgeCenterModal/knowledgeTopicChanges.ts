import type { KnowledgeTopic, KnowledgeTopicChanges, KnowledgeTopicProposal, KnowledgeTopicSuggestion } from '@shared/types/knowledge';

export function parseTopicSynonyms(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/u).map(term => term.trim()).filter(Boolean))].sort();
}

export function buildTopicChanges(input: {
  proposal: KnowledgeTopicProposal;
  suggestions: KnowledgeTopicSuggestion[];
  selected: Record<string, string[]>;
  synonyms: Record<string, string>;
  customIds: string[];
  mergeTargets: Record<string, string>;
}): KnowledgeTopicChanges {
  const topics: KnowledgeTopic[] = [];
  const assignments = new Map<string, KnowledgeTopicChanges['assignments'][number]>();
  const merges = Object.entries(input.mergeTargets).filter(([, targetId]) => targetId).map(([sourceId, targetId]) => ({ sourceId, targetId }));
  const sources = new Set(merges.map(item => item.sourceId));
  for (const suggestion of input.suggestions) {
    const id = suggestion.topic.id;
    if (sources.has(id)) continue;
    const selected = new Set(input.selected[id] ?? []);
    const synonyms = parseTopicSynonyms(input.synonyms[id] ?? suggestion.topic.synonyms.join(', '));
    const changed = JSON.stringify(synonyms) !== JSON.stringify([...suggestion.topic.synonyms].sort());
    if (selected.size || changed || input.customIds.includes(id)) topics.push({ ...suggestion.topic, synonyms });
    for (const card of suggestion.cards) {
      if (!selected.has(card.cardId)) continue;
      const existing = assignments.get(card.cardId);
      if (existing && existing.contentHash !== card.contentHash) throw new Error('KNOWLEDGE_TOPIC_SOURCE_CHANGED');
      if (existing) existing.topicIds.push(id);
      else assignments.set(card.cardId, { cardId: card.cardId, contentHash: card.contentHash, topicIds: [id] });
    }
  }
  return { expectedRevision: input.proposal.revision, expectedCorpusRevision: input.proposal.corpusRevision,
    topics, assignments: [...assignments.values()], merges };
}
