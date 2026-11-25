import { Badge, type BadgeTone } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import { TYPE_ICONS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import {
  countKnowledgeImportOutcomes,
  knowledgeImportOutcome,
  knowledgeQuarantineReason,
  type KnowledgeImportOutcome,
} from '../knowledgeImportExportModel';
import type { KnowledgeImportItem } from '@shared/types/knowledge';
import type { useKnowledgeCandidateInbox } from '../useKnowledgeCandidateInbox';

const OUTCOME_TONE: Record<KnowledgeImportOutcome, BadgeTone> = { new: 'success', present: 'neutral', conflict: 'warning', quarantine: 'error' };

const OUTCOME_LABEL_KEYS: Record<KnowledgeImportOutcome, TranslationKey> = {
  new: 'knowledgeCenter.importOutcome.new',
  present: 'knowledgeCenter.importOutcome.present',
  conflict: 'knowledgeCenter.importOutcome.conflict',
  quarantine: 'knowledgeCenter.importOutcome.quarantine',
};

const WRITTEN_LABEL_KEYS: Record<KnowledgeImportOutcome, TranslationKey> = {
  new: 'knowledgeCenter.importWritten.new',
  present: 'knowledgeCenter.importOutcome.present',
  conflict: 'knowledgeCenter.importWritten.conflict',
  quarantine: 'knowledgeCenter.importWritten.quarantine',
};

/** The one sentence an item needs beyond its status: why it is held back, or what it is missing. */
function ItemNote({ item }: { item: KnowledgeImportItem }) {
  const { t } = useI18n();
  const outcome = knowledgeImportOutcome(item);
  if (outcome === 'quarantine') {
    const reason = knowledgeQuarantineReason(item.reason);
    return <p className="knowledge-import-item-note">{t(reason ? `knowledgeCenter.importReason.${reason}` : 'knowledgeCenter.importStatusQuarantineHint')}</p>;
  }
  if (outcome === 'conflict') return <p className="knowledge-import-item-note">{t('knowledgeCenter.importConflictNote')}</p>;
  if (item.missingAssets.length > 0) {
    return <p className="knowledge-import-item-note">{t('knowledgeCenter.importMissingAssets', { count: item.missingAssets.length })}</p>;
  }
  return null;
}

export function ImportItems({ items, written, candidates, onProposed }: {
  items: readonly KnowledgeImportItem[];
  written: boolean;
  candidates?: ReturnType<typeof useKnowledgeCandidateInbox>;
  onProposed?: () => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="knowledge-import-items" data-testid="knowledge-center-import-items">
      {items.map((item, index) => {
        const outcome = knowledgeImportOutcome(item);
        const type = item.record?.type;
        const images = item.record?.images?.length ?? 0;
        const meta = [type ? t(TYPE_LABEL_KEYS[type]) : null, images ? t('knowledgeCenter.importImageCount', { count: images }) : null].filter(Boolean);
        return (
          <li key={`${item.record?.cardId ?? item.status}:${index}`} className="knowledge-import-item" data-outcome={outcome}>
            <Icon name={type ? TYPE_ICONS[type] : 'warning'} size={16} className="knowledge-import-item-icon" />
            <div className="knowledge-import-item-copy">
              <span className="knowledge-import-item-title">{item.record?.title ?? t('knowledgeCenter.importUnreadable')}</span>
              {meta.length ? <span className="knowledge-import-item-meta">{meta.join(' · ')}</span> : null}
              <ItemNote item={item} />
              {candidates?.candidateError && candidates.candidateError.cardId === item.record?.cardId ? (
                <InlineError detail={candidates.candidateError.message}>{humanizeError(candidates.candidateError.message, t, 'knowledgeCenter.candidateFailed')}</InlineError>
              ) : null}
            </div>
            <div className="knowledge-import-item-side">
              <Badge tone={OUTCOME_TONE[outcome]} data-status={outcome}>{t((written ? WRITTEN_LABEL_KEYS : OUTCOME_LABEL_KEYS)[outcome])}</Badge>
              {candidates && outcome === 'new' && item.record && candidates.hasSession && item.missingAssets.length === 0 ? (
                <Button variant="ghost" size="sm" disabled={candidates.busy} data-testid="knowledge-center-import-create-candidate"
                  onClick={() => void candidates.createCandidate(item.record!, onProposed)}>
                  {t('knowledgeCenter.importCreateCandidate')}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function OutcomeSummary({ items, written }: { items: readonly KnowledgeImportItem[]; written: boolean }) {
  const { t } = useI18n();
  const counts = countKnowledgeImportOutcomes(items);
  const rest = (['present', 'conflict', 'quarantine'] as const).filter((outcome) => counts[outcome] > 0)
    .map((outcome) => t(`knowledgeCenter.importSummary.${outcome}`, { count: counts[outcome] }));
  return (
    <div className="knowledge-import-summary" data-testid="knowledge-center-import-summary">
      <h3>{t(written ? 'knowledgeCenter.importSummary.written' : 'knowledgeCenter.importSummary.planned', { count: counts.new })}</h3>
      {rest.length ? <p>{rest.join(t('knowledgeCenter.listSeparator'))}</p> : null}
    </div>
  );
}
