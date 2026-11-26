import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { IconButton } from '../../../../ui/IconButton';
import { InlineError } from '../../../../ui/InlineError';
import { useCopyFeedback } from '../../../../ui/CopyButton';
import { Menu } from '../../../../ui/Menu';
import { useCopyDiagnostics } from '../../../../patterns/CopyDiagnostics';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import { detailToRecord, type KnowledgeWriteAction } from '../knowledgeCenterModel';
import { knowledgeCardActions, type KnowledgeCardAction } from '../knowledgeCardActions';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';
import type { KnowledgeCardDetail } from '@shared/types/knowledge';

const ACTION_LABEL_KEYS: Record<KnowledgeCardAction, TranslationKey> = {
  'create-candidate': 'knowledgeCenter.createCandidate',
  'persist-draft': 'knowledgeCenter.saveAsDraft',
  'promote-verified': 'knowledgeCenter.promoteVerified',
  'promote-promoted': 'knowledgeCenter.promotePromoted',
  save: 'knowledgeCenter.save',
  retire: 'knowledgeCenter.retire',
};

/** The selected card's footer: its primary lifecycle action, the rest and the diagnostics copy in a menu. */
export function KnowledgeCardActionBar({
  card,
  reviewing,
  write,
  onCreateCandidate,
  candidateHasSession,
  candidateBusy,
  candidateError,
}: {
  card: KnowledgeCardDetail;
  reviewing: boolean;
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  onCreateCandidate: () => void;
  candidateHasSession: boolean;
  candidateBusy: boolean;
  candidateError: string | null;
}) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const actions = knowledgeCardActions(card.lifecycle, reviewing);
  const { copied, copy } = useCopyFeedback(
    useCopyDiagnostics([
      { label: 'cardId', value: card.cardId },
      { label: 'caseId', value: card.caseId },
      { label: 'relations', value: card.relations.map((relation) => relation.targetCardId).join(', ') },
      { label: 'sourceStatus', value: card.sourceStatus },
      { label: t('knowledgeCenter.metaSourceHash'), value: card.sourceHash },
      {
        label: t('knowledgeCenter.metaSourceMtime'),
        value: card.sourceMtimeMs != null ? new Date(card.sourceMtimeMs).toISOString() : null,
      },
      { label: t('knowledgeCenter.metaSourceSize'), value: card.sourceSize },
    ]),
  );
  const candidateBlocked = !candidateHasSession
    ? t('knowledgeCenter.sessionRequired')
    : card.missingAssets?.length
      ? t('knowledgeCenter.candidateAssetsMissing')
      : undefined;
  const cardActionsLabel = t('knowledgeCenter.cardActions', { title: card.title });
  const run = (action: KnowledgeCardAction) => {
    if (action === 'create-candidate') {
      onCreateCandidate();
      return;
    }
    void write.openFor(action as KnowledgeWriteAction, detailToRecord(card));
  };

  return (
    <div className="knowledge-center-actions" data-testid="knowledge-center-actions">
      {candidateError ? (
        <InlineError detail={candidateError}>
          {humanizeError(candidateError, t, 'knowledgeCenter.candidateFailed')}
        </InlineError>
      ) : null}
      <Menu
        open={moreOpen}
        onOpenChange={setMoreOpen}
        align="end"
        side="top"
        label={cardActionsLabel}
        items={[
          ...actions.more.map((action) => ({
            id: action,
            label: t(ACTION_LABEL_KEYS[action]),
            onSelect: () => run(action),
          })),
          {
            id: 'diagnostics',
            testId: 'knowledge-center-provenance',
            label: t('app.copyDiagnostics'),
            onSelect: () => void copy(),
          },
        ]}
        trigger={
          <IconButton
            label={cardActionsLabel}
            size="sm"
            aria-haspopup="menu"
            data-testid="knowledge-center-more-actions"
            data-tooltip={t(copied ? 'app.copied' : 'knowledgeCenter.moreActions')}
          >
            <Icon name={copied ? 'check' : 'more'} size={16} />
          </IconButton>
        }
      />
      {actions.primary ? (
        <Button
          variant="primary"
          data-testid="knowledge-center-primary-action"
          data-action={actions.primary}
          disabled={actions.primary === 'create-candidate' && (Boolean(candidateBlocked) || candidateBusy)}
          data-tooltip={actions.primary === 'create-candidate' ? candidateBlocked : undefined}
          onClick={() => run(actions.primary!)}
        >
          {t(ACTION_LABEL_KEYS[actions.primary])}
        </Button>
      ) : null}
    </div>
  );
}
