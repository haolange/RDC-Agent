import { useId, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import type { TranslationKey } from '../../../../i18n/messages';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

const FIELD_LABELS: Record<string, TranslationKey> = {
  expected: 'knowledgeCenter.field.expected',
  observed: 'knowledgeCenter.field.observed',
  visual: 'knowledgeCenter.field.visual',
  phenomenon: 'knowledgeCenter.field.phenomenon',
  spatial_pattern: 'knowledgeCenter.field.spatial_pattern',
  temporal_pattern: 'knowledgeCenter.field.temporal_pattern',
  affected_objects: 'knowledgeCenter.field.affected_objects',
  summary: 'knowledgeCenter.field.summary',
  evidence_id: 'knowledgeCenter.field.evidence_id',
  type: 'knowledgeCenter.field.type',
  source: 'knowledgeCenter.field.source',
  tool: 'knowledgeCenter.field.tool',
  params: 'knowledgeCenter.field.params',
  file: 'knowledgeCenter.field.file',
  mechanism: 'knowledgeCenter.field.mechanism',
  blame: 'knowledgeCenter.field.blame',
  component: 'knowledgeCenter.field.component',
  location: 'knowledgeCenter.field.location',
  invariant_broken: 'knowledgeCenter.field.invariant_broken',
  category_primary: 'knowledgeCenter.field.category_primary',
  category_secondary: 'knowledgeCenter.field.category_secondary',
  platform: 'knowledgeCenter.field.platform',
  engine: 'knowledgeCenter.field.engine',
  api: 'knowledgeCenter.field.api',
  driver: 'knowledgeCenter.field.driver',
  featureConfiguration: 'knowledgeCenter.field.featureConfiguration',
  key_spirv_ids: 'knowledgeCenter.field.key_spirv_ids',
  main_trigger_id: 'knowledgeCenter.field.main_trigger_id',
  hlsl_anchor: 'knowledgeCenter.field.hlsl_anchor',
  symbol: 'knowledgeCenter.field.symbol',
  removed_decorations: 'knowledgeCenter.field.removed_decorations',
  decoration: 'knowledgeCenter.field.decoration',
};

export function parseChapterValue(content: string): Value | undefined {
  const text = content.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try { return JSON.parse(text) as Value; } catch { return undefined; }
}

function isCompactList(value: Value): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length < 60);
}

function StructuredValue({ value, depth = 0 }: { value: Value; depth?: number }) {
  const { t } = useI18n();
  if (value === null || typeof value !== 'object') return <span>{value === null ? 'null' : String(value)}</span>;
  if (depth > 12) return <pre className="knowledge-case-raw">{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) {
    if (!value.length) return <span>{t('knowledgeCenter.case.noItems')}</span>;
    const compact = isCompactList(value);
    return <ul className={`knowledge-case-values${compact ? ' is-compact' : ''}`}>{value.map((item, index) => (
      <li key={index}><StructuredValue value={item} depth={depth + 1} /></li>
    ))}</ul>;
  }
  if (!Object.keys(value).length) return <span>{t('knowledgeCenter.case.noFields')}</span>;
  return <dl className="knowledge-case-fields">{Object.entries(value).map(([key, item]) => (
    <div key={key} className={!isCompactList(item) && (typeof item === 'object' && item !== null || String(item).length > 75) ? 'is-wide' : undefined}>
      <dt title={key}>{FIELD_LABELS[key] ? t(FIELD_LABELS[key]) : key}</dt>
      <dd><StructuredValue value={item} depth={depth + 1} /></dd>
    </div>
  ))}</dl>;
}

function EvidenceItem({ value }: { value: Record<string, Value> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { summary, evidence_id: id, type, ...details } = value;
  return <article className="knowledge-evidence">
    <div className="knowledge-evidence-heading">
      {id !== undefined && <span className="knowledge-evidence-id"><StructuredValue value={id} /></span>}
      {type !== undefined && <span><StructuredValue value={type} /></span>}
    </div>
    {summary !== undefined && <div className="knowledge-evidence-summary"><StructuredValue value={summary} /></div>}
    {Object.keys(details).length > 0 && <>
      <Button variant="ghost" size="sm" className="knowledge-evidence-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        {t('knowledgeCenter.case.sourceDetails')}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={open ? 'm5 15 7-7 7 7' : 'm5 9 7 7 7-7'}/></svg>
      </Button>
      {open && <div id={detailsId} className="knowledge-evidence-details"><StructuredValue value={details} /></div>}
    </>}
  </article>;
}

export function CaseChapterContent({ content, chapter, spaceId }: { content: string; chapter?: string; spaceId: string }) {
  const { t } = useI18n();
  const value = parseChapterValue(content);
  if (chapter === 'evidence' && Array.isArray(value) && value.length > 0) return <div className="knowledge-evidence-list">
    {value.map((item, index) => item !== null && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0
      ? <EvidenceItem key={index} value={item} />
      : <div key={index}><StructuredValue value={item} /></div>)}
  </div>;
  if (chapter === 'symptoms' && value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    const { expected, observed, ...attributes } = value;
    return <div className="knowledge-symptoms">
      <div className="knowledge-symptom-comparison">
        {([['expected', expected], ['observed', observed]] as const).filter(([, item]) => item !== undefined).map(([key, item]) => (
          <div className={`knowledge-symptom ${key}`} key={key}>
            <div className="knowledge-symptom-label">{t(FIELD_LABELS[key])}</div>
            <StructuredValue value={item} />
          </div>
        ))}
      </div>
      {Object.keys(attributes).length > 0 && <StructuredValue value={attributes} />}
    </div>;
  }
  return value === undefined ? <KnowledgeMarkdown content={content} spaceId={spaceId} />
    : <div className="knowledge-case-structured"><StructuredValue value={value} /></div>;
}
