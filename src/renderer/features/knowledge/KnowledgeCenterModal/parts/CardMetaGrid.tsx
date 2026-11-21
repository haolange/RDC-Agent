import { KNOWLEDGE_SCOPE_AXES, type KnowledgeCardDetail } from '@shared/types/knowledge';
import { Details } from '../../../../ui/Details';
import { useI18n } from '../../../../i18n';
import { formatBytes } from '../../../../lib/formatBytes';
import { useUiLabels } from '../../../../lib/useUiLabels';
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
 * Metadata for the selected card: type / lifecycle / source status / caseId / updatedAt /
 * space / relative path, scope axes with exclusions, relations named by title, and a
 * collapsed 诊断 group (import hash / mtime / size) when the card was ingested.
 */
export function CardMetaGrid({ card, spaceLabel, resolveTitle, onOpenRelation }: CardMetaGridProps) {
  const { t, language } = useI18n();
  const labels = useUiLabels();
  const exclusions = card.scope.exclusions ?? {};
  const axes = KNOWLEDGE_SCOPE_AXES.filter((axis) => card.scope[axis] || exclusions[axis]?.length);
  const hasProvenance = Boolean(card.sourceHash || card.sourceMtimeMs != null || card.sourceSize != null);
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
            <dt>{t('knowledgeCenter.metaSourceStatus')}</dt>
            <dd>{card.sourceStatus ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaCaseId')}</dt>
            <dd>{card.caseId ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaUpdatedAt')}</dt>
            <dd>{formatKnowledgeTime(card.updatedAt) || '—'}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaSpace')}</dt>
            <dd>{spaceLabel}</dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.metaRelativePath')}</dt>
            <dd><code>{card.relativePath}</code></dd>
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
                      {card.scope[axis] ?? '—'}
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
      <Details className="knowledge-center-meta-details" data-testid="knowledge-center-provenance" summary={labels.diagnostics}>
        {hasProvenance ? (
          <dl className="knowledge-center-meta knowledge-center-meta--compact">
            <div>
              <dt>{t('knowledgeCenter.metaSourceHash')}</dt>
              <dd><code>{card.sourceHash ?? '—'}</code></dd>
            </div>
            <div>
              <dt>{t('knowledgeCenter.metaSourceMtime')}</dt>
              <dd>{formatKnowledgeTime(card.sourceMtimeMs) || '—'}</dd>
            </div>
            <div>
              <dt>{t('knowledgeCenter.metaSourceSize')}</dt>
              <dd>{card.sourceSize != null ? formatBytes(card.sourceSize, language) : '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="knowledge-center-meta-empty">{t('knowledgeCenter.metaProvenanceNone')}</p>
        )}
      </Details>
    </div>
  );
}
