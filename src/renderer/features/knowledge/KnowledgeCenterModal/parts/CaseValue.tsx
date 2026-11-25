import { useI18n } from '../../../../i18n';
import { SCOPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import {
  humanizeKey,
  humanizeTerm,
  isCaseRecord,
  isTermLike,
  looksLikeIdentifier,
  splitIdentifiers,
  type CaseRecord,
  type CaseValue,
} from '../knowledgeCaseValues';
import type { TranslationKey } from '../../../../i18n/messages';
import type { KnowledgeScopeAxis } from '@shared/types/knowledge';

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

const FIELD_LABELS: Record<string, TranslationKey> = {
  expected: 'knowledgeCenter.field.expected',
  observed: 'knowledgeCenter.field.observed',
  visual: 'knowledgeCenter.field.visual',
  first_bad_event: 'knowledgeCenter.field.first_bad_event',
  responsible_layer: 'knowledgeCenter.field.responsible_layer',
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

/** A key in words: the case vocabulary first, then scope axes, and any other key humanized. */
export function fieldLabel(key: string, t: Translate): string {
  if (FIELD_LABELS[key]) return t(FIELD_LABELS[key]);
  return key in SCOPE_LABEL_KEYS ? t(SCOPE_LABEL_KEYS[key as KnowledgeScopeAxis]) : humanizeKey(key);
}

/** Sentences stay sentences; the identifiers inside them (`%17`, `I-NORM-02`) read as code. */
export function Prose({ text }: { text: string }) {
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

export function Value({ value }: { value: CaseValue }) {
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
export function Facts({ record }: { record: CaseRecord }) {
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
