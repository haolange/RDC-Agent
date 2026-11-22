import { useId, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import { Chevron } from '../../../../ui/Chevron';
import { SCOPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import {
  humanizeKey,
  humanizeTerm,
  isCaseRecord,
  isTermLike,
  looksLikeIdentifier,
  parseChapterValue,
  splitIdentifiers,
  withoutInternalReferences,
  type CaseRecord,
  type CaseValue,
} from '../knowledgeCaseValues';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';
import type { TranslationKey } from '../../../../i18n/messages';
import type { KnowledgeCaseChapter, KnowledgeScopeAxis } from '@shared/types/knowledge';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

const FIELD_LABELS: Record<string, TranslationKey> = {
  expected: 'knowledgeCenter.field.expected',
  observed: 'knowledgeCenter.field.observed',
  phenomenon: 'knowledgeCenter.field.phenomenon',
  spatial_pattern: 'knowledgeCenter.field.spatial_pattern',
  temporal_pattern: 'knowledgeCenter.field.temporal_pattern',
  affected_objects: 'knowledgeCenter.field.affected_objects',
  tool: 'knowledgeCenter.field.tool',
  file: 'knowledgeCenter.field.file',
  component: 'knowledgeCenter.field.component',
  location: 'knowledgeCenter.field.location',
  invariant_broken: 'knowledgeCenter.field.invariant_broken',
  category_primary: 'knowledgeCenter.field.category_primary',
  category_secondary: 'knowledgeCenter.field.category_secondary',
  key_spirv_ids: 'knowledgeCenter.field.key_spirv_ids',
  main_trigger_id: 'knowledgeCenter.field.main_trigger_id',
  hlsl_anchor: 'knowledgeCenter.field.hlsl_anchor',
  symbol: 'knowledgeCenter.field.symbol',
  removed_decorations: 'knowledgeCenter.field.removed_decorations',
  decoration: 'knowledgeCenter.field.decoration',
};

/** Common evidence kinds in words; any other kind reads as its humanized name. */
const EVIDENCE_KIND_LABELS: Record<string, TranslationKey> = {
  image_compare: 'knowledgeCenter.evidenceKind.image_compare',
  spirv_decoration_diff: 'knowledgeCenter.evidenceKind.spirv_decoration_diff',
  spirv_slice: 'knowledgeCenter.evidenceKind.spirv_slice',
  shader_source_mapping: 'knowledgeCenter.evidenceKind.shader_source_mapping',
};

/** A key in words: the case vocabulary first, then scope axes, and any other key humanized. */
function fieldLabel(key: string, t: Translate): string {
  if (FIELD_LABELS[key]) return t(FIELD_LABELS[key]);
  return key in SCOPE_LABEL_KEYS ? t(SCOPE_LABEL_KEYS[key as KnowledgeScopeAxis]) : humanizeKey(key);
}

/** Sentences stay sentences; the identifiers inside them (`%17`, `I-NORM-02`) read as code. */
function Prose({ text }: { text: string }) {
  return <>{splitIdentifiers(text).map((segment, index) => (segment.code ? <code key={index}>{segment.text}</code> : segment.text))}</>;
}

function ValueText({ value }: { value: string }) {
  const { t } = useI18n();
  if (value.trim().toLowerCase() === 'unknown') return <>{t('knowledgeCenter.valueUnknown')}</>;
  if (isTermLike(value)) return <>{humanizeTerm(value)}</>;
  if (looksLikeIdentifier(value)) return <code>{value}</code>;
  return <Prose text={value} />;
}

/** A list of short values sits on one line: identifiers as code chips, words joined by the list separator. */
function ValueList({ items }: { items: CaseValue[] }) {
  const { t } = useI18n();
  const strings = items.every((item) => typeof item === 'string' && item.length < 80);
  if (strings && items.every((item) => looksLikeIdentifier(item as string))) {
    return <span className="knowledge-case-codes">{items.map((item, index) => <code key={index}>{item as string}</code>)}</span>;
  }
  if (strings && items.every((item) => !isTermLike(item as string) && !looksLikeIdentifier(item as string))) {
    return <Prose text={(items as string[]).join(t('knowledgeCenter.listSeparator'))} />;
  }
  if (strings) {
    return <>{items.map((item, index) => (
      <span key={index}>{index > 0 ? t('knowledgeCenter.listSeparator') : null}<ValueText value={item as string} /></span>
    ))}</>;
  }
  return <ul className="knowledge-case-list">{items.map((item, index) => <li key={index}><Value value={item} /></li>)}</ul>;
}

function Value({ value }: { value: CaseValue }) {
  if (value === null) return <>—</>;
  if (typeof value === 'string') return <ValueText value={value} />;
  if (typeof value !== 'object') return <>{String(value)}</>;
  if (Array.isArray(value)) return <ValueList items={value} />;
  return <Facts record={value} />;
}

/** Nested objects (a source with its parameters, a blame with its location) contribute their rows to one list. */
function factRows(record: CaseRecord, path = ''): Array<{ path: string; key: string; value: CaseValue }> {
  return Object.entries(record).flatMap(([key, value]) => (isCaseRecord(value)
    ? factRows(value, `${path}${key}.`)
    : [{ path: `${path}${key}`, key, value }]));
}

/** Facts as label–value rows. */
function Facts({ record }: { record: CaseRecord }) {
  const { t } = useI18n();
  const rows = factRows(record);
  if (!rows.length) return null;
  return (
    <dl className="knowledge-case-facts">
      {rows.map(({ path, key, value }) => (
        <div key={path}>
          <dt>{fieldLabel(key, t)}</dt>
          <dd><Value value={value} /></dd>
        </div>
      ))}
    </dl>
  );
}

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
              <div className="knowledge-symptom-label">{t(FIELD_LABELS[key])}</div>
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
