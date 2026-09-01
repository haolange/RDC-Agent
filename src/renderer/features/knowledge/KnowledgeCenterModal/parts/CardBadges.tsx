import type { KnowledgeCardType, KnowledgeLifecycle } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { LIFECYCLE_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';

interface CardBadgesProps {
  type?: KnowledgeCardType;
  lifecycle?: KnowledgeLifecycle;
  sourceStatus?: string;
}

export function CardBadges({ type, lifecycle, sourceStatus }: CardBadgesProps) {
  const { t } = useI18n();
  return (
    <div className="knowledge-center-badges">
      {type && <span className="knowledge-center-badge">{t(TYPE_LABEL_KEYS[type])}</span>}
      {lifecycle && (
        <span className={`knowledge-center-badge knowledge-center-badge--${lifecycle}`}>
          {t(LIFECYCLE_LABEL_KEYS[lifecycle])}
        </span>
      )}
      {sourceStatus && (
        <span className="knowledge-center-badge">
          {sourceStatus}
          {sourceStatus === 'fixed' ? ` ${t('knowledgeCenter.fixedNotVerified')}` : ''}
        </span>
      )}
    </div>
  );
}
