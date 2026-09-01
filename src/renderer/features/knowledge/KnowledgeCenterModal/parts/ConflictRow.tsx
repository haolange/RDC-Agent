import { useI18n } from '../../../../i18n';

interface ConflictRowProps {
  leftCardId: string;
  rightCardId: string;
  onSelect?: (cardId: string) => void;
}

export function ConflictRow({ leftCardId, rightCardId, onSelect }: ConflictRowProps) {
  const { t } = useI18n();
  return (
    <div className="knowledge-center-conflict-row" data-testid="knowledge-center-conflict-row">
      <button type="button" className="knowledge-center-conflict-id" onClick={() => onSelect?.(leftCardId)}>
        {leftCardId}
      </button>
      <span className="knowledge-center-conflict-swap" aria-hidden="true">↔</span>
      <button type="button" className="knowledge-center-conflict-id" onClick={() => onSelect?.(rightCardId)}>
        {rightCardId}
      </button>
      <span className="knowledge-center-badge">{t('knowledgeCenter.conflictsKind')}</span>
    </div>
  );
}
