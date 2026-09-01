import { KNOWLEDGE_SCOPE_AXES, type KnowledgeCardDetail } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { LIFECYCLE_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { CardBadges } from './CardBadges';

interface CardMetaGridProps {
  card: KnowledgeCardDetail;
}

export function CardMetaGrid({ card }: CardMetaGridProps) {
  const { t } = useI18n();
  const exclusions = card.scope.exclusions ?? {};
  const axes = KNOWLEDGE_SCOPE_AXES.filter((axis) => card.scope[axis] || exclusions[axis]?.length);
  return (
    <dl className="knowledge-center-meta" data-testid="knowledge-center-meta">
      <div>
        <dt>{t('knowledgeCenter.metaType')}</dt>
        <dd>{card.type ? t(TYPE_LABEL_KEYS[card.type]) : '—'}</dd>
      </div>
      <div>
        <dt>{t('knowledgeCenter.metaLifecycle')}</dt>
        <dd>{card.lifecycle ? t(LIFECYCLE_LABEL_KEYS[card.lifecycle]) : '—'}</dd>
      </div>
      <div>
        <dt>{t('knowledgeCenter.metaSourceStatus')}</dt>
        <dd>
          <CardBadges sourceStatus={card.sourceStatus} />
          {!card.sourceStatus && '—'}
        </dd>
      </div>
      <div>
        <dt>{t('knowledgeCenter.metaCaseId')}</dt>
        <dd>{card.caseId ?? '—'}</dd>
      </div>
      <div>
        <dt>{t('knowledgeCenter.metaUpdatedAt')}</dt>
        <dd>{card.updatedAt ? new Date(card.updatedAt).toISOString() : '—'}</dd>
      </div>
      <div className="knowledge-center-meta-wide">
        <dt>{t('knowledgeCenter.metaScope')}</dt>
        <dd>
          {axes.length === 0 && '—'}
          {axes.map((axis) => (
            <span key={axis} className="knowledge-center-scope-chip">
              {axis}: {card.scope[axis] ?? ''}
              {exclusions[axis]?.length ? ` · ${t('knowledgeCenter.metaExclusions')} ${exclusions[axis]?.join(', ')}` : ''}
            </span>
          ))}
        </dd>
      </div>
      <div className="knowledge-center-meta-wide">
        <dt>{t('knowledgeCenter.metaRelations')}</dt>
        <dd>
          {card.relations.length === 0 && '—'}
          {card.relations.map((relation) => (
            <span key={`${relation.kind}:${relation.targetCardId}`} className="knowledge-center-scope-chip">
              {relation.kind} → {relation.targetCardId}
            </span>
          ))}
        </dd>
      </div>
    </dl>
  );
}
