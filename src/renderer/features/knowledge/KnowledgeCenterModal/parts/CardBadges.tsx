import { useI18n } from '../../../../i18n';
import { Badge, type BadgeTone } from '../../../../ui/Badge';
import { LIFECYCLE_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import type { KnowledgeCardType, KnowledgeLifecycle } from '@shared/types/knowledge';

interface CardBadgesProps {
  type?: KnowledgeCardType;
  lifecycle?: KnowledgeLifecycle;
  sourceStatus?: string;
}

/** Lifecycle reads as state (verified succeeds, retired recedes); type and source are plain labels. */
const LIFECYCLE_TONE: Record<KnowledgeLifecycle, BadgeTone> = {
  draft: 'neutral', candidate: 'warning', verified: 'success', promoted: 'accent', retired: 'neutral',
};

export function CardBadges({ type, lifecycle, sourceStatus }: CardBadgesProps) {
  const { t } = useI18n();
  return (
    <span className="knowledge-center-badges">
      {type && <Badge variant="outline">{t(TYPE_LABEL_KEYS[type])}</Badge>}
      {lifecycle && (
        <Badge tone={LIFECYCLE_TONE[lifecycle]} variant={lifecycle === 'draft' || lifecycle === 'retired' ? 'outline' : 'soft'}>
          {t(LIFECYCLE_LABEL_KEYS[lifecycle])}
        </Badge>
      )}
      {sourceStatus && (
        <Badge variant="outline">
          {sourceStatus}
          {sourceStatus === 'fixed' ? ` ${t('knowledgeCenter.fixedNotVerified')}` : ''}
        </Badge>
      )}
    </span>
  );
}
