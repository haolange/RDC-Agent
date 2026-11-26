import { ListRow } from '../../../../ui/ListRow';
import { Icon } from '../../../../ui/Icon';
import { useI18n } from '../../../../i18n';
import { formatDateTime } from '../../../../lib/formatTime';
import type { KnowledgeLaneHit } from '@shared/types/knowledge';

interface ConflictRowProps {
  left?: Pick<KnowledgeLaneHit, 'title' | 'updatedAt'> | null;
  right?: Pick<KnowledgeLaneHit, 'title' | 'updatedAt'> | null;
  selected?: boolean;
  onSelect?: () => void;
}

/** Titles identify a pair in the review queue. The more recent timestamp distinguishes updates. */
export function ConflictRow({ left, right, selected = false, onSelect }: ConflictRowProps) {
  const { t, language } = useI18n();
  const title = (
    <span className="knowledge-center-card-title">
      {left?.title ?? t('knowledgeCenter.conflictCardA')}
      <Icon name="conflict" className="knowledge-center-conflict-swap" size={14} />
      {right?.title ?? t('knowledgeCenter.conflictCardB')}
    </span>
  );
  const updated = formatDateTime(language, Math.max(left?.updatedAt ?? 0, right?.updatedAt ?? 0) || undefined);
  if (!onSelect) return <p className="knowledge-write-conflict">{title}</p>;
  return (
    <ListRow
      className="knowledge-center-conflict-row"
      data-testid="knowledge-center-conflict-row"
      selected={selected}
      onClick={onSelect}
      trailing={updated ? <span className="knowledge-center-conflict-time">{updated}</span> : undefined}
    >
      {title}
    </ListRow>
  );
}
