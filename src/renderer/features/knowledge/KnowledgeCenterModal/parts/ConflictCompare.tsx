import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Chevron } from '../../../../ui/Chevron';
import { Icon } from '../../../../ui/Icon';
import { useI18n } from '../../../../i18n';
import { formatDateTime } from '../../../../lib/formatTime';
import { Skeleton } from '../../../../ui/Skeleton';
import { KnowledgeStatusTag } from './KnowledgeStatusTag';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';

interface ConflictCompareProps {
  left: KnowledgeCardDetail | null;
  right: KnowledgeCardDetail | null;
  loading: boolean;
  onOpenCard: (card: KnowledgeCardDetail) => void;
}

function ConflictCardPane({
  label,
  card,
  loading,
  onOpen,
}: {
  label: string;
  card: KnowledgeCardDetail | null;
  loading: boolean;
  onOpen: () => void;
}) {
  const { t, language } = useI18n();
  return (
    <section className="knowledge-conflict-pane" data-testid="knowledge-conflict-pane">
      <header className="knowledge-conflict-pane-head">
        <strong>{label}</strong>
        {card ? (
          <Button variant="ghost" size="sm" onClick={onOpen} data-testid="knowledge-conflict-open-card">
            {t('knowledgeCenter.viewRelatedCard')}
            <Chevron />
          </Button>
        ) : null}
      </header>
      {loading && !card ? (
        <div role="status" aria-label={t('knowledgeCenter.loading')}>
          <Skeleton shape="line" count={4} />
        </div>
      ) : card ? (
        <dl className="knowledge-conflict-pane-grid">
          <div>
            <dt>{t('knowledgeCenter.conflictTitle')}</dt>
            <dd>
              {card.title}
              <KnowledgeStatusTag lifecycle={card.lifecycle} sourceStatus={card.sourceStatus} />
            </dd>
          </div>
          <div>
            <dt>{t('knowledgeCenter.conflictContent')}</dt>
            <dd className="knowledge-conflict-pane-content">{card.preview || card.body.slice(0, 480)}</dd>
          </div>
          {card.updatedAt ? (
            <div>
              <dt>{t('knowledgeCenter.metaUpdatedAt')}</dt>
              <dd>{formatDateTime(language, card.updatedAt)}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <p className="knowledge-center-status">{t('knowledgeCenter.conflictCardMissing')}</p>
      )}
    </section>
  );
}

/** Side-by-side comparison of a contradicts pair; review is manual, there is no automatic resolution. */
export function ConflictCompare({ left, right, loading, onOpenCard }: ConflictCompareProps) {
  const { t } = useI18n();
  const leftTitle = left?.title ?? t('knowledgeCenter.conflictCardA');
  const rightTitle = right?.title ?? t('knowledgeCenter.conflictCardB');
  return (
    <article className="knowledge-conflict-compare" data-testid="knowledge-conflict-compare">
      <header className="knowledge-conflict-compare-head">
        <h1 className="knowledge-center-header-title">
          {leftTitle}
          <Icon name="conflict" className="knowledge-center-conflict-swap" size={16} />
          {rightTitle}
        </h1>
        <Badge tone="warning">{t('knowledgeCenter.conflictPending')}</Badge>
      </header>
      <p className="knowledge-center-meta-line">{t('knowledgeCenter.conflictCompareHint')}</p>
      <div className="knowledge-conflict-panes">
        <ConflictCardPane
          label={t('knowledgeCenter.conflictCardA')}
          card={left}
          loading={loading}
          onOpen={() => left && onOpenCard(left)}
        />
        <ConflictCardPane
          label={t('knowledgeCenter.conflictCardB')}
          card={right}
          loading={loading}
          onOpen={() => right && onOpenCard(right)}
        />
      </div>
    </article>
  );
}
