import { KNOWLEDGE_SCOPE_AXES, type KnowledgeCardDetail } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { CopyDiagnosticsButton } from '../../../../patterns/CopyDiagnostics';
import { formatKnowledgeTime, LIFECYCLE_LABEL_KEYS, RELATION_LABEL_KEYS, SCOPE_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { Button } from '../../../../ui/Button';

interface CardMetaGridProps {
  card: KnowledgeCardDetail;
  /** Human label of the card's space (User / project label). */
  spaceLabel: string;
  /** The title of a related card when it is loaded; otherwise its file name stands in. */
  resolveTitle?: (targetCardId: string) => string | undefined;
  /** Present when a relation target can be opened from here. */
  onOpenRelation?: (targetCardId: string) => void;
}

/** A related card named by its title, or by its file name when the card is not loaded. */
const relationTargetName = (targetCardId: string, title: string | undefined): string => (
  title || (targetCardId.split('/').pop() ?? targetCardId).replace(/\.md$/u, '')
);

/**
 * What a reader may want to know about the selected card: its type, topics, lifecycle, when it changed and where it
 * lives, the scope it applies to and how it relates to other cards. Identifiers and source facts (case id, file,
 * import hash, size) are not shown; they leave through the copy action.
 */
export function CardMetaGrid({ card, spaceLabel, resolveTitle, onOpenRelation }: CardMetaGridProps) {
  const { t } = useI18n();
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
            <dd>{formatKnowledgeTime(card.updatedAt) || '—'}</dd>
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
                {card.relations.map((relation) => (
                  <li key={`${relation.kind}:${relation.targetCardId}`}>
                    <span className="knowledge-center-relation-kind">{t(RELATION_LABEL_KEYS[relation.kind])}</span>
                    {onOpenRelation ? (
                      <Button variant="ghost" size="sm" className="knowledge-center-relation-target" data-tooltip={relation.targetCardId}
                        onClick={() => onOpenRelation(relation.targetCardId)}>
                        {relationTargetName(relation.targetCardId, resolveTitle?.(relation.targetCardId))}
                      </Button>
                    ) : <span data-tooltip={relation.targetCardId}>{relationTargetName(relation.targetCardId, resolveTitle?.(relation.targetCardId))}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <CopyDiagnosticsButton className="knowledge-center-copy-diagnostics" testId="knowledge-center-provenance" facts={[
        { label: 'cardId', value: card.cardId },
        { label: 'caseId', value: card.caseId },
        { label: 'sourceStatus', value: card.sourceStatus },
        { label: t('knowledgeCenter.metaSourceHash'), value: card.sourceHash },
        { label: t('knowledgeCenter.metaSourceMtime'), value: card.sourceMtimeMs ? new Date(card.sourceMtimeMs).toISOString() : null },
        { label: t('knowledgeCenter.metaSourceSize'), value: card.sourceSize },
      ]} />
    </div>
  );
}
