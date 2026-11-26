import { useRef, useState } from 'react';
import { Tabs } from '../../../../ui/Tabs';
import { motionScrollBehavior } from '../../../../lib/motion';
import { useI18n } from '../../../../i18n';
import { CHAPTER_LABEL_KEYS } from '../knowledgeCenterLabels';
import { hasReadableCaseChapter } from '../knowledgeCaseValues';
import { bodyWithoutTitle, markdownOutline } from '../knowledgeOutline';
import { CaseChapterContent } from './CaseChapterContent';
import { KnowledgeCardImages } from './KnowledgeCardImages';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import type { KnowledgeCardDetail, KnowledgeCaseChapter } from '@shared/types/knowledge';

/** An outline earns its place once there are a few sections to move between. */
const OUTLINE_MIN_ENTRIES = 3;

/**
 * A case reads like a write-up: what was seen, the evidence, why it happened, the fix and how it was verified, then
 * where it applies. The claim is the lead sentence under the title, not a section of its own.
 */
const CASE_READING_ORDER: readonly KnowledgeCaseChapter[] = [
  'symptoms',
  'evidence',
  'rootCause',
  'fix',
  'experimentVerification',
  'derived',
  'negative',
  'openChallenges',
  'scopeExclusions',
];

const sameText = (left: string, right: string) => left.replace(/\s+/gu, '') === right.replace(/\s+/gu, '');

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

  return chapters.length === 1 ? (
    section
  ) : (
    <Tabs
      className="knowledge-case-tabs"
      label={t('knowledgeCenter.outline')}
      tabs={chapters.map((entry) => ({ id: entry, label: t(CHAPTER_LABEL_KEYS[entry]) }))}
      value={chapter}
      onChange={setSelected}
    >
      {section}
    </Tabs>
  );
}

/** The card's reading body: its claim, images, an outline for long notes, then its chapters or Markdown. */
export function KnowledgeCardDocument({ card }: { card: KnowledgeCardDetail }) {
  const { t } = useI18n();
  const textRef = useRef<HTMLDivElement>(null);
  const chapters =
    card.type === 'case' && card.chapters
      ? CASE_READING_ORDER.filter((chapter) => hasReadableCaseChapter(card.chapters?.[chapter]))
      : null;
  const claim = card.chapters?.claim?.trim();
  const lead = claim && !sameText(claim, card.title) ? claim : null;
  const body = !chapters?.length ? bodyWithoutTitle(card.body, card.title) : '';
  const outline = markdownOutline(body)
    .filter((heading) => heading.level <= 3)
    .map((heading) => heading.title);
  const jumpTo = (index: number) => {
    textRef.current
      ?.querySelectorAll('h1, h2, h3')
      [index]?.scrollIntoView({ block: 'start', behavior: motionScrollBehavior() });
  };

  return (
    <div className="knowledge-center-document">
      {lead ? <p className="knowledge-case-claim">{lead}</p> : null}
      {card.images?.length ? (
        <KnowledgeCardImages
          key={JSON.stringify(['images', card.spaceId, card.cardId])}
          spaceId={card.spaceId}
          images={card.images}
        />
      ) : null}
      {outline.length >= OUTLINE_MIN_ENTRIES ? (
        <nav
          className="knowledge-center-chapters"
          aria-label={t('knowledgeCenter.outline')}
          data-testid="knowledge-center-chapters"
        >
          {outline.map((label, index) => (
            <button
              key={`${label}:${index}`}
              type="button"
              className="knowledge-center-outline-link"
              onClick={() => jumpTo(index)}
            >
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
  );
}
