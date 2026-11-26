import { useI18n } from '../../../../i18n';
import { Badge, type BadgeTone } from '../../../../ui/Badge';
import { LIFECYCLE_HINT_KEYS, LIFECYCLE_LABEL_KEYS } from '../knowledgeCenterLabels';
import type { KnowledgeLifecycle } from '@shared/types/knowledge';

/** Lifecycle reads as state: verified succeeds, promoted stands out, a candidate waits, retired recedes. */
const LIFECYCLE_TONE: Record<KnowledgeLifecycle, BadgeTone> = {
  draft: 'neutral',
  candidate: 'warning',
  verified: 'success',
  promoted: 'accent',
  retired: 'neutral',
};

/**
 * The one status a card carries, in words, with its meaning on hover. A fix that has not been verified says so
 * (「已修复 · 未验证」): fixing is not verifying. Lists leave the default draft state untagged.
 */
export function KnowledgeStatusTag({
  lifecycle,
  sourceStatus,
  reviewing = false,
  hideDraft = false,
}: {
  lifecycle?: KnowledgeLifecycle;
  sourceStatus?: string;
  /** A candidate in the review queue reads as waiting for the user. */
  reviewing?: boolean;
  hideDraft?: boolean;
}) {
  const { t } = useI18n();
  const fixedUnverified = sourceStatus === 'fixed' && lifecycle !== 'verified' && lifecycle !== 'promoted';
  if (!reviewing && !fixedUnverified && (!lifecycle || (hideDraft && lifecycle === 'draft'))) return null;
  const label = reviewing
    ? t('knowledgeCenter.pendingReview')
    : fixedUnverified
      ? t('knowledgeCenter.statusFixedUnverified')
      : t(LIFECYCLE_LABEL_KEYS[lifecycle!]);
  const hint = reviewing
    ? t(LIFECYCLE_HINT_KEYS.candidate)
    : fixedUnverified
      ? t('knowledgeCenter.statusFixedUnverifiedHint')
      : lifecycle
        ? t(LIFECYCLE_HINT_KEYS[lifecycle])
        : undefined;
  const tone = reviewing || fixedUnverified ? 'warning' : LIFECYCLE_TONE[lifecycle!];
  return (
    <Badge
      tone={tone}
      variant={tone === 'neutral' ? 'outline' : 'soft'}
      data-tooltip={hint}
      data-testid="knowledge-status-tag"
    >
      {label}
    </Badge>
  );
}
