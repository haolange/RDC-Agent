import { useRef, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { EmptyState } from '../../../../ui/EmptyState';
import { Icon } from '../../../../ui/Icon';
import { IconButton } from '../../../../ui/IconButton';
import { InlineError } from '../../../../ui/InlineError';
import { Chevron } from '../../../../ui/Chevron';
import { Menu } from '../../../../ui/Menu';
import { Panel } from '../../../../ui/Panel';
import { Tabs } from '../../../../ui/Tabs';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { CHAPTER_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { detailToRecord, type KnowledgeWriteAction } from '../knowledgeCenterModel';
import { knowledgeCardActions, type KnowledgeCardAction } from '../knowledgeCardActions';
import { bodyWithoutTitle, markdownOutline } from '../knowledgeOutline';
import { CaseChapterContent } from '../parts/CaseChapterContent';
import { KnowledgeCardImages } from '../parts/KnowledgeCardImages';
import { KnowledgeMarkdown } from '../parts/KnowledgeMarkdown';
import '../parts/KnowledgeDetail.css';
import { KnowledgeStatusTag } from '../parts/KnowledgeStatusTag';
import { CardMetaGrid } from '../parts/CardMetaGrid';
import { ConflictCompare } from '../parts/ConflictCompare';
import { Skeleton } from '../../../../ui/Skeleton';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';
import type { KnowledgeCardDetail, KnowledgeCaseChapter, KnowledgeScopeAxis } from '@shared/types/knowledge';

interface DetailColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  onCreateCandidate: () => void;
  candidateHasSession: boolean;
  candidateBusy: boolean;
  candidateError: string | null;
}

const ACTION_LABEL_KEYS: Record<KnowledgeCardAction, TranslationKey> = {
  'create-candidate': 'knowledgeCenter.createCandidate',
  'persist-draft': 'knowledgeCenter.saveAsDraft',
  'promote-verified': 'knowledgeCenter.promoteVerified',
  'promote-promoted': 'knowledgeCenter.promotePromoted',
  save: 'knowledgeCenter.save',
  retire: 'knowledgeCenter.retire',
};

/** An outline earns its place once there are a few sections to move between. */
const OUTLINE_MIN_ENTRIES = 3;

/**
 * A case reads like a write-up: what was seen, the evidence, why it happened, the fix and how it was verified, then
 * where it applies. The claim is the lead sentence under the title, not a section of its own.
 */
const CASE_READING_ORDER: readonly KnowledgeCaseChapter[] = [
  'symptoms', 'evidence', 'rootCause', 'fix', 'experimentVerification', 'derived', 'negative', 'openChallenges', 'scopeExclusions',
];

/** The scope axes that say at a glance where a card applies, in the order people name them. */
const HEADLINE_AXES: readonly KnowledgeScopeAxis[] = ['platform', 'api', 'gpuVendor', 'gpuArch', 'device', 'engine'];

const sameText = (left: string, right: string) => left.replace(/\s+/gu, '') === right.replace(/\s+/gu, '');

function headlineFacts(card: KnowledgeCardDetail, typeLabel: string | null): string[] {
  const axes = HEADLINE_AXES.map((axis) => card.scope[axis]?.trim()).filter((value): value is string => Boolean(value) && value!.toLowerCase() !== 'unknown');
  return [...(typeLabel ? [typeLabel] : []), ...axes];
}

function CaseChapters({ card, chapters }: { card: KnowledgeCardDetail; chapters: KnowledgeCaseChapter[] }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string>(chapters[0] ?? '');
  const chapter = chapters.find((entry) => entry === selected) ?? chapters[0];
  if (!chapter) return null;

  const section = (
    <section className="knowledge-case-section" key={chapter} data-chapter={chapter}>
      {chapters.length === 1 ? <h2>{t(CHAPTER_LABEL_KEYS[chapter])}</h2> : null}
      <CaseChapterContent spaceId={card.spaceId} chapter={chapter} content={card.chapters![chapter]!} />
    </section>
  );

  return chapters.length === 1 ? section : (
    <Tabs className="knowledge-case-tabs" label={t('knowledgeCenter.outline')}
      tabs={chapters.map((entry) => ({ id: entry, label: t(CHAPTER_LABEL_KEYS[entry]) }))}
      value={chapter} onChange={setSelected}>
      {section}
    </Tabs>
  );
}

export function DetailColumn({ state, write, onCreateCandidate, candidateHasSession, candidateBusy, candidateError }: DetailColumnProps) {
  const { t } = useI18n();
  const card = state.selectedCard;
  const conflict = state.viewMode === 'conflicts' ? state.selectedConflict : null;
  const [infoOpen, setInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const reviewing = state.viewMode === 'candidates';
  const space = card ? state.spaces.find((entry) => entry.spaceId === card.spaceId) : undefined;
  const spaceLabel = space?.kind === 'user' ? t('knowledgeCenter.userSpace') : (space?.label ?? '');
  const chapters = card?.type === 'case' && card.chapters
    ? CASE_READING_ORDER.filter((chapter) => card.chapters?.[chapter]?.trim())
    : null;
  const claim = card?.chapters?.claim?.trim();
  const lead = card && claim && !sameText(claim, card.title) ? claim : null;
  const facts = card ? headlineFacts(card, card.type ? t(TYPE_LABEL_KEYS[card.type]) : null) : [];
  const body = card && !chapters?.length ? bodyWithoutTitle(card.body, card.title) : '';
  const outline = markdownOutline(body).filter((heading) => heading.level <= 3).map((heading) => heading.title);
  const actions = card ? knowledgeCardActions(card.lifecycle, reviewing) : null;
  const candidateBlocked = !candidateHasSession ? t('knowledgeCenter.sessionRequired')
    : card?.missingAssets?.length ? t('knowledgeCenter.candidateAssetsMissing') : undefined;

  const jumpTo = (index: number) => {
    textRef.current?.querySelectorAll('h1, h2, h3')[index]
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const run = (action: KnowledgeCardAction) => {
    if (!card) return;
    if (action === 'create-candidate') {
      onCreateCandidate();
      return;
    }
    void write.openFor(action as KnowledgeWriteAction, detailToRecord(card));
  };

  return (
    <Panel className="knowledge-center-content" data-testid="knowledge-center-detail-column">
      {/* The modal title bar owns the product title and close; this header only identifies the selected card. */}
      {card || state.narrow ? (
        <div className="knowledge-center-header">
          <div className="knowledge-center-header-copy">
            {state.narrow && (
              <Button variant="ghost" size="sm" onClick={() => state.setNarrowPane('list')}>
                {t('knowledgeCenter.back')}
              </Button>
            )}
            {card ? (
              <>
                <h1 className="knowledge-center-header-title">{card.title}</h1>
                <div className="knowledge-center-meta-line" data-testid="knowledge-center-meta-line">
                  {facts.length ? <span className="knowledge-center-facts">{facts.join(' · ')}</span> : null}
                  <KnowledgeStatusTag lifecycle={card.lifecycle} sourceStatus={card.sourceStatus} reviewing={reviewing} />
                </div>
              </>
            ) : null}
          </div>
          <div className="knowledge-center-header-actions">
            {card ? (
              <Button
                variant="ghost"
                size="sm"
                className="knowledge-detail-info-toggle"
                aria-expanded={infoOpen}
                aria-controls="knowledge-card-information"
                onClick={() => setInfoOpen(!infoOpen)}
                data-testid="knowledge-center-metadata-toggle"
              >
                {t('knowledgeCenter.metadata')}
                <Chevron direction="down" open={infoOpen} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="knowledge-center-body" data-testid="knowledge-center-body">
        {state.loadingDetail && <div role="status" aria-label={t('knowledgeCenter.loading')}><Skeleton shape="line" count={8} /></div>}
        {conflict ? (
          <ConflictCompare
            conflict={conflict}
            left={state.conflictCards.left}
            right={state.conflictCards.right}
            loading={state.loadingDetail}
            onOpenCard={state.openRelatedCard}
          />
        ) : null}
        {!state.loadingDetail && !card && !conflict && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-detail">
            <EmptyState
              variant="page"
              title={t(state.viewMode === 'conflicts' ? 'knowledgeCenter.selectConflictPrompt' : reviewing ? 'knowledgeCenter.selectCandidatePrompt' : 'knowledgeCenter.selectPrompt')}
              description={state.viewMode === 'cards' && state.hits.length === 0 ? t('knowledgeCenter.emptyDetailHint') : undefined}
            />
          </div>
        )}
        {!state.loadingDetail && card && (
          <article data-testid="knowledge-center-detail">
            {infoOpen ? (
              <div id="knowledge-card-information" className="knowledge-detail-info">
                <CardMetaGrid
                  card={card}
                  spaceLabel={spaceLabel}
                  resolveTitle={(targetCardId) => (state.hits.find((entry) => entry.cardId === targetCardId)
                    ?? state.pack?.hits.find((entry) => entry.cardId === targetCardId))?.title}
                  onOpenRelation={(targetCardId) => {
                    const hit = state.hits.find((entry) => entry.cardId === targetCardId)
                      ?? state.pack?.hits.find((entry) => entry.cardId === targetCardId);
                    if (hit) state.openRelatedCard(hit);
                  }}
                />
              </div>
            ) : null}
            <div className="knowledge-center-document">
              {lead ? <p className="knowledge-case-claim">{lead}</p> : null}
              {card.images?.length ? <KnowledgeCardImages spaceId={card.spaceId} images={card.images} /> : null}
              {outline.length >= OUTLINE_MIN_ENTRIES ? (
                <nav className="knowledge-center-chapters" aria-label={t('knowledgeCenter.outline')} data-testid="knowledge-center-chapters">
                  {outline.map((label, index) => (
                    <button key={`${label}:${index}`} type="button" className="knowledge-center-outline-link" onClick={() => jumpTo(index)}>
                      {label}
                    </button>
                  ))}
                </nav>
              ) : null}
              {chapters?.length ? (
                <CaseChapters key={JSON.stringify([card.spaceId, card.cardId])} card={card} chapters={chapters} />
              ) : (
                <div ref={textRef} className="knowledge-center-markdown">
                  <KnowledgeMarkdown content={body} spaceId={card.spaceId} />
                </div>
              )}
            </div>
          </article>
        )}
      </div>

      {card && actions ? (
        <div className="knowledge-center-actions" data-testid="knowledge-center-actions">
          {candidateError ? <InlineError detail={candidateError}>{t('knowledgeCenter.candidateFailed')}</InlineError> : null}
          {actions.more.length > 0 ? (
            <Menu
              open={moreOpen}
              onOpenChange={setMoreOpen}
              align="end"
              side="top"
              label={t('knowledgeCenter.moreActions')}
              items={actions.more.map((action) => ({ id: action, label: t(ACTION_LABEL_KEYS[action]), onSelect: () => run(action) }))}
              trigger={(
                <IconButton label={t('knowledgeCenter.moreActions')} size="sm" data-testid="knowledge-center-more-actions">
                  <Icon name="more" size={16} />
                </IconButton>
              )}
            />
          ) : null}
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
      ) : null}
    </Panel>
  );
}
