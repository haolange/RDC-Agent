import type { KnowledgeCardDetail, KnowledgePackConflict } from '@shared/types/knowledge';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { useI18n } from '../../../../i18n';
import { formatKnowledgeTime } from '../knowledgeCenterLabels';
import { CardBadges } from './CardBadges';

interface ConflictCompareProps {
  conflict: KnowledgePackConflict;
  left: KnowledgeCardDetail | null;
  right: KnowledgeCardDetail | null;
  loading: boolean;
  onOpenCard: (card: KnowledgeCardDetail) => void;
}

function ConflictCardPane({
  label,
  cardId,
  card,
  loading,
  onOpen,
}: {
  label: string;
  cardId: string;
  card: KnowledgeCardDetail | null;
  loading: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="knowledge-conflict-pane" data-testid="knowledge-conflict-pane">
      <header className="knowledge-conflict-pane-head">
        <strong>{label}</strong>
        {card ? (
          <Button variant="ghost" size="sm" onClick={onOpen} data-testid="knowledge-conflict-open-card">
            {t('knowledgeCenter.viewRelatedCard')}
            <Icon name="chevron-right" size={14} />
          </Button>
        ) : null}
      </header>
      {loading && !card ? (
        <p className="knowledge-center-status">{t('knowledgeCenter.loading')}</p>
      ) : card ? (
        <dl className="knowledge-conflict-pane-grid">
          <div>
            <dt>{t('knowledgeCenter.sourceLabel')}</dt>
            <dd>
              <code>{card.spaceId}</code> · <code>{card.relativePath}</code>
              {card.sourceStatus ? ` · ${card.sourceStatus}` : ''}
            </dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.conflictTitle')}</dt>
            <dd>
              {card.title}
              <CardBadges type={card.type} lifecycle={card.lifecycle} />
            </dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.conflictContent')}</dt>
            <dd className="knowledge-conflict-pane-content">{card.preview || card.body.slice(0, 480)}</dd>
          </div>
          {card.updatedAt ? (
            <div>
              <dt>{t('knowledgeCenter.metaUpdatedAt')}</dt>
              <dd>{formatKnowledgeTime(card.updatedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="knowledge-center-status">
          <code>{cardId}</code> · {t('knowledgeCenter.conflictCardMissing')}
        </p>
      )}
    </section>
  );
}

/** Side-by-side comparison of a contradicts pair; review is manual, there is no automatic resolution. */
export function ConflictCompare({ conflict, left, right, loading, onOpenCard }: ConflictCompareProps) {
  const { t } = useI18n();
  const leftTitle = left?.title || conflict.leftCardId;
  const rightTitle = right?.title || conflict.rightCardId;
  return (
    <article className="knowledge-conflict-compare" data-testid="knowledge-conflict-compare">
      <header className="knowledge-conflict-compare-head">
        <h1 className="knowledge-center-header-title">
          {leftTitle}
          <span className="knowledge-center-conflict-swap" aria-hidden="true">↔</span>
          {rightTitle}
        </h1>
        <Badge tone="warning">{t('knowledgeCenter.conflictPending')}</Badge>
      </header>
      <p className="knowledge-center-meta-line">{t('knowledgeCenter.conflictCompareHint', { a: leftTitle, b: rightTitle })}</p>
      <div className="knowledge-conflict-panes">
        <ConflictCardPane
          label={t('knowledgeCenter.conflictCardA')}
          cardId={conflict.leftCardId}
          card={left}
          loading={loading}
          onOpen={() => left && onOpenCard(left)}
        />
        <ConflictCardPane
          label={t('knowledgeCenter.conflictCardB')}
          cardId={conflict.rightCardId}
          card={right}
          loading={loading}
          onOpen={() => right && onOpenCard(right)}
        />
      </div>
    </article>
  );
}
