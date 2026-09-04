import type { KnowledgeRetrievalLane } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { LANE_LABEL_KEYS } from '../knowledgeCenterLabels';

interface LaneStatusListProps {
  lanes: readonly KnowledgeRetrievalLane[];
  enabled: KnowledgeRetrievalLane[];
  onToggle: (lane: KnowledgeRetrievalLane) => void;
}

export function LaneStatusList({ lanes, enabled, onToggle }: LaneStatusListProps) {
  const { t } = useI18n();
  return (
    <div className="knowledge-center-lanes" data-testid="knowledge-center-lanes">
      <div className="knowledge-center-section-title">{t('knowledgeCenter.lanesTitle')}</div>
      {lanes.map((lane) => {
        const checked = enabled.includes(lane);
        return (
          <label key={lane} className="knowledge-center-check">
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(lane)}
            />
            <span>{t(LANE_LABEL_KEYS[lane])}</span>
          </label>
        );
      })}
    </div>
  );
}
