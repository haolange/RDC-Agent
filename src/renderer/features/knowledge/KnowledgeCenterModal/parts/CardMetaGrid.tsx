import { KNOWLEDGE_SCOPE_AXES, type KnowledgeCardDetail } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { formatKnowledgeTime, LIFECYCLE_LABEL_KEYS, SCOPE_LABELS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { Button } from '../../../../ui/Button';
import { CardBadges } from './CardBadges';

interface CardMetaGridProps {
  card: KnowledgeCardDetail;
  /** Human label of the card's space (User / project label). */
  spaceLabel: string;
  /** Present when a relation target can be opened from here. */
  onOpenRelation?: (targetCardId: string) => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Metadata for the selected card: type / lifecycle / source status / caseId / updatedAt /
 * space / relative path, scope axes with exclusions, relations, and a collapsed
 * provenance block (import hash / mtime / size) when the card was ingested.
 */
export function CardMetaGrid({ card, spaceLabel, onOpenRelation }: CardMetaGridProps) {
  const { t, language } = useI18n();
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
                    <dt title={axis}>{SCOPE_LABELS[axis][language === 'zh-CN' ? 1 : 0]}</dt>
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
                    <span className="knowledge-center-relation-kind">{relation.kind}</span>
                    {onOpenRelation ? (
                      <Button variant="ghost" size="sm" className="knowledge-center-relation-target" onClick={() => onOpenRelation(relation.targetCardId)}>
                        <code>{relation.targetCardId}</code>
                      </Button>
                    ) : <code>{relation.targetCardId}</code>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      <details className="knowledge-center-meta-details" data-testid="knowledge-center-provenance">
        <summary>{t('knowledgeCenter.metaProvenance')}</summary>
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
              <dd>{card.sourceSize != null ? formatBytes(card.sourceSize) : '—'}</dd>
            </div>
          </dl>
        ) : (
          <p className="knowledge-center-meta-empty">{t('knowledgeCenter.metaProvenanceNone')}</p>
        )}
      </details>
    </div>
  );
}
