import type { SemanticLaneStatus } from '@shared/types/embedding';
import type { KnowledgeRetrievalLane } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { LANE_LABEL_KEYS, semanticReasonKey } from '../knowledgeCenterLabels';

interface LaneStatusListProps {
  lanes: readonly KnowledgeRetrievalLane[];
  enabled: KnowledgeRetrievalLane[];
  semantic: SemanticLaneStatus | null;
  semanticReady: boolean;
  onToggle: (lane: KnowledgeRetrievalLane) => void;
}

export function LaneStatusList({ lanes, enabled, semantic, semanticReady, onToggle }: LaneStatusListProps) {
  const { t } = useI18n();
  const semanticClosed = !semanticReady;
  return (
    <div className="knowledge-center-lanes" data-testid="knowledge-center-lanes">
      <div className="knowledge-center-section-title">{t('knowledgeCenter.lanesTitle')}</div>
      {lanes.map((lane) => {
        const disabled = lane === 'Semantic' && semanticClosed;
        const checked = enabled.includes(lane) && !disabled;
        return (
          <label
            key={lane}
            className={`knowledge-center-check ${disabled ? 'is-disabled' : ''}`}
            aria-disabled={disabled || undefined}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              aria-disabled={disabled || undefined}
              onChange={() => onToggle(lane)}
            />
            <span>{t(LANE_LABEL_KEYS[lane])}</span>
          </label>
        );
      })}
      <div className="knowledge-center-semantic-status" data-testid="knowledge-center-semantic-status">
        {!semantic && t('knowledgeCenter.semanticUnavailable')}
        {semantic?.availability === 'ready' && t('knowledgeCenter.semanticReady')}
        {semantic?.availability === 'unavailable' && t('knowledgeCenter.semanticUnavailable')}
        {semantic?.availability === 'stale' && t('knowledgeCenter.semanticStale')}
        {semantic && semantic.availability !== 'ready' && (
          <>
            <span> · {t(semanticReasonKey(semantic))}</span>
            <span> · {t('knowledgeCenter.semanticSettingsHint')}</span>
          </>
        )}
      </div>
    </div>
  );
}
