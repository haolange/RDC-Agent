import { useId, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import { Chevron } from '../../../../ui/Chevron';
import {
  humanizeTerm,
  isCaseRecord,
  parseChapterValue,
  withoutInternalReferences,
  type CaseRecord,
  type CaseValue,
} from '../knowledgeCaseValues';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import { Facts, Prose, Value, fieldLabel } from './CaseValue';
import type { TranslationKey } from '../../../../i18n/messages';
import type { KnowledgeCaseChapter } from '@shared/types/knowledge';

/** Common evidence kinds in words; any other kind reads as its humanized name. */
const EVIDENCE_KIND_LABELS: Record<string, TranslationKey> = {
  image_compare: 'knowledgeCenter.evidenceKind.image_compare',
  spirv_decoration_diff: 'knowledgeCenter.evidenceKind.spirv_decoration_diff',
  spirv_slice: 'knowledgeCenter.evidenceKind.spirv_slice',
  shader_source_mapping: 'knowledgeCenter.evidenceKind.shader_source_mapping',
};

function Symptoms({ record }: { record: CaseRecord }) {
  const { t } = useI18n();
  const { expected, observed, ...rest } = record;
  const sides = ([['expected', expected], ['observed', observed]] as const).filter(([, item]) => item !== undefined);
  return (
    <div className="knowledge-symptoms">
      {sides.length ? (
        <div className="knowledge-symptom-comparison">
          {sides.map(([key, item]) => (
            <div className={`knowledge-symptom is-${key}`} key={key}>
              <div className="knowledge-symptom-label">{fieldLabel(key, t)}</div>
              <p className="knowledge-symptom-text"><Value value={item!} /></p>
            </div>
          ))}
        </div>
      ) : null}
      <Facts record={rest} />
    </div>
  );
}

function EvidenceItem({ record }: { record: CaseRecord }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  // The evidence id names the record for its author; the reader gets the finding and, on request, how it was found.
  const { summary, evidence_id: _id, type, ...details } = record;
  const kind = typeof type === 'string' ? (EVIDENCE_KIND_LABELS[type] ? t(EVIDENCE_KIND_LABELS[type]) : humanizeTerm(type)) : null;
  const source = withoutInternalReferences(details);
  return (
    <li className="knowledge-evidence">
      {kind ? <span className="knowledge-evidence-kind">{kind}</span> : null}
      {summary !== undefined ? <p className="knowledge-evidence-summary"><Value value={summary} /></p> : null}
      {isCaseRecord(source) ? (
        <>
          <Button variant="ghost" size="sm" className="knowledge-evidence-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
            {t('knowledgeCenter.case.sourceDetails')}
            <Chevron direction="down" open={open} />
          </Button>
          {open ? <div id={detailsId} className="knowledge-evidence-details"><Facts record={source} /></div> : null}
        </>
      ) : null}
    </li>
  );
}

function RootCause({ record }: { record: CaseRecord }) {
  const { mechanism, ...rest } = record;
  return (
    <div className="knowledge-root-cause">
      {typeof mechanism === 'string' ? <p className="knowledge-case-lead"><Prose text={mechanism} /></p> : null}
      {mechanism !== undefined && typeof mechanism !== 'string' ? <Value value={mechanism} /> : null}
      <Facts record={rest} />
    </div>
  );
}

function Steps({ items }: { items: CaseValue[] }) {
  return (
    <ol className="knowledge-case-steps">
      {items.map((item, index) => <li key={index}><span className="knowledge-case-step-text"><Value value={item} /></span></li>)}
    </ol>
  );
}

/**
 * One case chapter as part of an authored document. Each chapter has its own form — symptoms compare expected with
 * observed, evidence lists findings with their sources one click away, the root cause leads with its mechanism,
 * verification is a numbered procedure — and any other structured value reads as label–value facts. Internal
 * references are left out; text that is not JSON is Markdown.
 */
export function CaseChapterContent({ content, chapter, spaceId }: { content: string; chapter?: KnowledgeCaseChapter; spaceId: string }) {
  const parsed = parseChapterValue(content);
  if (parsed === undefined) return <KnowledgeMarkdown content={content} spaceId={spaceId} />;
  const value = withoutInternalReferences(parsed);
  if (value === undefined) return null;
  if (chapter === 'symptoms' && isCaseRecord(value)) return <Symptoms record={value} />;
  if (chapter === 'rootCause' && isCaseRecord(value)) return <RootCause record={value} />;
  if (chapter === 'evidence' && Array.isArray(value)) {
    return (
      <ol className="knowledge-evidence-list">
        {value.map((item, index) => (isCaseRecord(item)
          ? <EvidenceItem key={index} record={item} />
          : <li key={index} className="knowledge-evidence"><p className="knowledge-evidence-summary"><Value value={item} /></p></li>))}
      </ol>
    );
  }
  if (Array.isArray(value) && (chapter === 'experimentVerification' || chapter === 'negative' || chapter === 'openChallenges')) {
    return <Steps items={value} />;
  }
  return <div className="knowledge-case-structured"><Value value={value} /></div>;
}
