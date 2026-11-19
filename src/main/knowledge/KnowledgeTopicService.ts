import { createHash } from 'node:crypto';
import type {
  KnowledgeTopic, KnowledgeTopicChanges, KnowledgeTopicDocument, KnowledgeTopicPreview, KnowledgeTopicProposal,
} from '@shared/types/knowledge';
import { appPathService } from '../runtime/AppPathService';
import { knowledgeIndexService, type KnowledgeIndexService } from './KnowledgeIndexService';
import type { KnowledgeIndexEntry } from './knowledgeLanes';
import { KnowledgeTopicChangesSchema, KnowledgeTopicStore } from './KnowledgeTopicStore';
import { knowledgeTextMatches } from './knowledgeVocabulary';

const seeds: KnowledgeTopic[] = [
  { id: 'shader', label: 'Shader', synonyms: ['着色器'] },
  { id: 'texture', label: 'Texture', synonyms: ['纹理'] },
  { id: 'pixel', label: 'Pixel', synonyms: ['像素'] },
  { id: 'sampling', label: 'Sampling', synonyms: ['采样'] },
  { id: 'filtering', label: 'Filtering', synonyms: ['过滤'] },
  { id: 'precision', label: 'Precision', synonyms: ['精度'] },
  { id: 'bandwidth', label: 'Bandwidth', synonyms: ['带宽'] },
  { id: 'memory', label: 'Memory', synonyms: ['内存'] },
  { id: 'render-pass', label: 'Render pass', synonyms: ['渲染通道'] },
  { id: 'resource', label: 'Resource', synonyms: ['资源'] },
  { id: 'geometry', label: 'Geometry', synonyms: ['几何'] },
  { id: 'material', label: 'Material', synonyms: ['材质'] },
  { id: 'lighting', label: 'Lighting', synonyms: ['光照'] },
  { id: 'transparency', label: 'Transparency', synonyms: ['透明'] },
  { id: 'rasterization', label: 'Rasterization', synonyms: ['光栅化'] },
  { id: 'post-processing', label: 'Post-processing', synonyms: ['后处理'] },
  { id: 'performance', label: 'Performance', synonyms: ['性能'] },
  { id: 'replay', label: 'Replay', synonyms: ['回放'] },
];

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const userCards = (cards: KnowledgeIndexEntry[]): KnowledgeIndexEntry[] => cards.filter(card => card.spaceId === 'user');

export class KnowledgeTopicService {
  constructor(private readonly store: KnowledgeTopicStore, private readonly index: KnowledgeIndexService) {}

  async suggest(): Promise<KnowledgeTopicProposal> {
    const [{ document, revision }, snapshot] = await Promise.all([this.store.read(), this.index.getOrRebuild()]);
    const cards = userCards(snapshot.cards);
    const sources = [...new Map([...seeds, ...document.topics].map(topic => [topic.id, topic])).values()];
    const cardCounts = new Map<string, number>();
    for (const card of cards) cardCounts.set(card.cardId, (cardCounts.get(card.cardId) ?? 0) + 1);
    const suggestions = sources.map(seed => {
      const topic = document.topics.find(item => item.id === seed.id) ?? seed;
      return {
        topic, existing: document.topics.some(item => item.id === seed.id),
        cards: cards.flatMap(card => {
          if (cardCounts.get(card.cardId) !== 1) return [];
          const prior = document.assignments.find(item => item.cardId === card.cardId);
          if (prior?.contentHash === card.contentHash && prior.topicIds.includes(topic.id)) return [];
          const matchedTerms = [topic.label, ...topic.synonyms].filter(term => knowledgeTextMatches(card.lexical, term, []));
          return matchedTerms.length ? [{ cardId: card.cardId, title: card.title, relativePath: card.relativePath, contentHash: card.contentHash, matchedTerms }] : [];
        }),
      };
    }).filter(suggestion => suggestion.existing || suggestion.cards.length > 0);
    return { revision, corpusRevision: snapshot.revision, current: document, suggestions };
  }

  private async calculate(raw: KnowledgeTopicChanges): Promise<{ preview: KnowledgeTopicPreview; next: KnowledgeTopicDocument }> {
    const changes = KnowledgeTopicChangesSchema.parse(raw);
    const [{ document, revision }, snapshot] = await Promise.all([this.store.read(), this.index.getOrRebuild()]);
    if (changes.expectedRevision !== revision) throw new Error('KNOWLEDGE_TOPICS_CHANGED: refresh the proposal.');
    if (changes.expectedCorpusRevision !== snapshot.revision) throw new Error('KNOWLEDGE_INDEX_CHANGED: refresh the proposal.');
    if (new Set(changes.topics.map(topic => topic.id)).size !== changes.topics.length
      || new Set(changes.assignments.map(item => item.cardId)).size !== changes.assignments.length) {
      throw new Error('KNOWLEDGE_TOPICS_DUPLICATE: each topic and card may appear only once.');
    }
    if (!changes.topics.length && !changes.assignments.length && !changes.merges.length) throw new Error('KNOWLEDGE_TOPICS_EMPTY: choose at least one change.');
    const topics = new Map(document.topics.map(topic => [topic.id, topic]));
    for (const topic of changes.topics) topics.set(topic.id, { ...topic, synonyms: sorted(topic.synonyms) });
    const assignments = new Map(document.assignments.map(item => [item.cardId, item]));
    const userEntries = userCards(snapshot.cards);
    const cardCounts = new Map<string, number>();
    for (const card of userEntries) cardCounts.set(card.cardId, (cardCounts.get(card.cardId) ?? 0) + 1);
    const cardsById = new Map(userEntries.map(card => [card.cardId, card]));
    const cards = new Map<string, KnowledgeTopicPreview['cards'][number]>();
    const merges: KnowledgeTopicPreview['merges'] = [];
    const mergeSources = new Set(changes.merges.map(item => item.sourceId));
    if (mergeSources.size !== changes.merges.length || changes.merges.some(item => item.sourceId === item.targetId || mergeSources.has(item.targetId))) {
      throw new Error('KNOWLEDGE_TOPIC_MERGE_INVALID: merge sources must be distinct and targets cannot themselves be merged.');
    }
    for (const merge of changes.merges) {
      const source = topics.get(merge.sourceId), target = topics.get(merge.targetId);
      if (!source || !target) throw new Error('KNOWLEDGE_TOPIC_UNKNOWN: merge source or target is missing.');
      const combined = { ...target, synonyms: sorted([...target.synonyms, source.label, ...source.synonyms]) };
      topics.set(target.id, combined);
      topics.delete(source.id);
      merges.push({ source, target: combined });
      for (const old of assignments.values()) {
        if (!old.topicIds.includes(source.id)) continue;
        if ((cardCounts.get(old.cardId) ?? 0) > 1) throw new Error('KNOWLEDGE_TOPIC_CARD_AMBIGUOUS: duplicate card identity.');
        const card = cardsById.get(old.cardId);
        const before = document.assignments.find(item => item.cardId === old.cardId)?.topicIds ?? [];
        const after = sorted([...old.topicIds.filter(id => id !== source.id), target.id]);
        assignments.set(old.cardId, { ...old, topicIds: after });
        cards.set(old.cardId, { cardId: old.cardId, title: card?.title ?? old.cardId, relativePath: card?.relativePath ?? '',
          before, after, stale: !card || card.contentHash !== old.contentHash });
      }
    }
    for (const change of changes.assignments) {
      const card = cardsById.get(change.cardId);
      if ((cardCounts.get(change.cardId) ?? 0) > 1) throw new Error('KNOWLEDGE_TOPIC_CARD_AMBIGUOUS: duplicate card identity.');
      if (!card || card.contentHash !== change.contentHash) throw new Error('KNOWLEDGE_TOPIC_SOURCE_CHANGED: refresh the proposal.');
      if (!change.topicIds.length || change.topicIds.some(id => !topics.has(id))) throw new Error('KNOWLEDGE_TOPIC_UNKNOWN: assignments require existing or proposed topics.');
      const old = assignments.get(card.cardId);
      const stale = Boolean(old && old.contentHash !== card.contentHash);
      const before = document.assignments.find(item => item.cardId === card.cardId)?.topicIds ?? [];
      const after = sorted([...(stale ? [] : old?.topicIds ?? []), ...change.topicIds]);
      assignments.set(card.cardId, { cardId: card.cardId, contentHash: card.contentHash, topicIds: after });
      cards.set(card.cardId, { cardId: card.cardId, title: card.title, relativePath: card.relativePath, before, after, stale });
    }
    const next: KnowledgeTopicDocument = {
      schemaVersion: 1,
      topics: [...topics.values()].sort((left, right) => left.id.localeCompare(right.id)),
      assignments: [...assignments.values()].sort((left, right) => left.cardId.localeCompare(right.cardId)),
    };
    // Validate the entire intended result before presenting or committing it.
    this.store.validate(next);
    const preview: KnowledgeTopicPreview = {
      revision, corpusRevision: snapshot.revision, changeHash: hash({ changes, next }), topics: changes.topics, merges, cards: [...cards.values()],
    };
    return { preview, next };
  }

  async preview(changes: KnowledgeTopicChanges): Promise<KnowledgeTopicPreview> {
    return (await this.calculate(changes)).preview;
  }

  async apply(changes: KnowledgeTopicChanges, changeHash: string): Promise<{ revision: string }> {
    return this.store.withWriteLock(async () => {
      const { preview, next } = await this.calculate(changes);
      if (preview.changeHash !== changeHash) throw new Error('KNOWLEDGE_TOPICS_PREVIEW_CHANGED: review the changes again.');
      return { revision: await this.store.write(preview.revision, next) };
    });
  }
}

export const knowledgeTopicStore = new KnowledgeTopicStore(() => appPathService.getUserRdcPaths().knowledgePath);
export const knowledgeTopicService = new KnowledgeTopicService(knowledgeTopicStore, knowledgeIndexService);
