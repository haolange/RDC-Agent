import type { KnowledgeLaneHit } from '@shared/types/knowledge';
import { Badge } from '../../../../ui/Badge';
import { ListRow } from '../../../../ui/ListRow';
import { useI18n } from '../../../../i18n';
import { formatKnowledgeTime } from '../knowledgeCenterLabels';

interface ConflictRowProps {
  leftCardId: string;
  rightCardId: string;
  /** Resolved titles / timestamps from the compiled pack; ids fall back when a card is not in the current pack. */
  left?: Pick<KnowledgeLaneHit, 'title' | 'updatedAt'> | null;
  right?: Pick<KnowledgeLaneHit, 'title' | 'updatedAt'> | null;
  selected?: boolean;
  onSelect?: () => void;
}

/** One contradicts pair: topic (left ↔ right titles), pending-review status, latest update. */
export function ConflictRow({ leftCardId, rightCardId, left, right, selected = false, onSelect }: ConflictRowProps) {
  const { t } = useI18n();
  const leftTitle = left?.title || leftCardId;
  const rightTitle = right?.title || rightCardId;
  const updated = formatKnowledgeTime(Math.max(left?.updatedAt ?? 0, right?.updatedAt ?? 0) || undefined);
  return (
    <ListRow
      className="knowledge-center-conflict-row"
      data-testid="knowledge-center-conflict-row"
      selected={selected}
      onClick={onSelect}
      disabled={!onSelect}
      trailing={(
        <span className="knowledge-center-conflict-trailing">
          <Badge tone="warning">{t('knowledgeCenter.conflictPending')}</Badge>
          {updated ? <small>{updated}</small> : null}
        </span>
      )}
    >
      <span className="knowledge-center-conflict-copy">
        <span className="knowledge-center-card-title">
          {leftTitle}
          <span className="knowledge-center-conflict-swap" aria-hidden="true">↔</span>
          {rightTitle}
        </span>
        <small className="knowledge-center-conflict-ids">
          <code>{leftCardId}</code> · <code>{rightCardId}</code> · {t('knowledgeCenter.conflictsKind')}
        </small>
      </span>
    </ListRow>
  );
}
