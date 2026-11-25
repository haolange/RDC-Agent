import { KNOWLEDGE_SCOPE_AXES, type KnowledgeCardDetail, type KnowledgeLaneHit } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { formatDateTime } from '../../../../lib/formatTime';
import { LIFECYCLE_LABEL_KEYS, RELATION_LABEL_KEYS, SCOPE_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { Button } from '../../../../ui/Button';

interface CardMetaGridProps {
  card: KnowledgeCardDetail;
  /** Human label of the card's space (User / project label). */
  spaceLabel: string;
  resolveRelation: (targetCardId: string) => KnowledgeLaneHit | undefined;
  onOpenRelation: (hit: KnowledgeLaneHit) => void;
}

/**
 * What a reader may want to know about the selected card: its type, topics, lifecycle, when it changed and where it
 * lives, the scope it applies to and how it relates to other cards.
 */
export function CardMetaGrid({ card, spaceLabel, resolveRelation, onOpenRelation }: CardMetaGridProps) {
  const { t, language } = useI18n();
  const exclusions = card.scope.exclusions ?? {};
  const axes = KNOWLEDGE_SCOPE_AXES.filter((axis) => card.scope[axis] || exclusions[axis]?.length);
  return (
    <div className="knowledge-center-meta-block" data-testid="knowledge-center-meta">
      <div className="knowledge-center-meta-columns">
        <dl className="knowledge-center-meta">
          <div>
            <dt>{t('knowledgeCenter.metaType')}</dt>
            <dd>{card.type ? t(TYPE_LABEL_KEYS[card.type]) : '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaTopics')}</dt>
            <dd>{card.topics?.map(topic => topic.label).join(', ') || '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaLifecycle')}</dt>
            <dd>{card.lifecycle ? t(LIFECYCLE_LABEL_KEYS[card.lifecycle]) : '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaUpdatedAt')}</dt>
            <dd>{formatDateTime(language, card.updatedAt) || '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaSpace')}</dt>
            <dd>{spaceLabel}</dd>
          </div>
        </dl>
        <div className="knowledge-center-meta-side">
          <section className="knowledge-center-meta-section">
            <h4>{t('knowledgeCenter.metaScope')}</h4>
            {axes.length === 0 ? <p className="knowledge-center-meta-empty">—</p> : (
              <dl className="knowledge-center-meta knowledge-center-meta--compact">
                {axes.map((axis) => (
                  <div key={axis}>
                    <dt>{t(SCOPE_LABEL_KEYS[axis])}</dt>
                    <dd>
                      {card.scope[axis]?.trim().toLowerCase() === 'unknown' ? t('knowledgeCenter.valueUnknown') : card.scope[axis] ?? '—'}
                      {exclusions[axis]?.length ? (
                        <span className="knowledge-center-scope-chip">
                          {t('knowledgeCenter.metaExclusions')}: {exclusions[axis]?.join(', ')}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          <section className="knowledge-center-meta-section">
            <h4>{t('knowledgeCenter.metaRelations')}</h4>
            {card.relations.length === 0 ? <p className="knowledge-center-meta-empty">—</p> : (
              <ul className="knowledge-center-relation-list">
                {card.relations.map((relation) => {
                  const hit = resolveRelation(relation.targetCardId);
                  return <li key={`${relation.kind}:${relation.targetCardId}`}>
                    <span className="knowledge-center-relation-kind">{t(RELATION_LABEL_KEYS[relation.kind])}</span>
                    {hit ? (
                      <Button variant="ghost" size="sm" className="knowledge-center-relation-target"
                        onClick={() => onOpenRelation(hit)}>
                        {hit.title}
                      </Button>
                    ) : <span>{t('knowledgeCenter.relationUnavailable')}</span>}
                  </li>;
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
