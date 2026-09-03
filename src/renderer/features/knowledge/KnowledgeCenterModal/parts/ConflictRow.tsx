import { Button } from '../../../../ui/Button';
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
      <Button variant="ghost" className="knowledge-center-conflict-id" onClick={() => onSelect?.(leftCardId)}>
        {leftCardId}
      </Button>
      <span className="knowledge-center-conflict-swap" aria-hidden="true">↔</span>
      <Button variant="ghost" className="knowledge-center-conflict-id" onClick={() => onSelect?.(rightCardId)}>
        {rightCardId}
      </Button>
      <span className="knowledge-center-badge">{t('knowledgeCenter.conflictsKind')}</span>
    </div>
  );
}
