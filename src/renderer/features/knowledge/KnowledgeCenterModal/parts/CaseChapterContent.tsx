import { useId, useState } from 'react';
import { MessageMarkdown } from '../../../debugger/AgentChat/MessageMarkdown';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';

type Value = null | boolean | number | string | Value[] | { [key: string]: Value };

export function parseChapterValue(content: string): Value | undefined {
  const text = content.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return undefined;
  try { return JSON.parse(text) as Value; } catch { return undefined; }
}

const labels: Record<string, [string, string]> = {
  expected: ['Expected', '预期表现'], observed: ['Observed', '实际表现'],
  visual: ['Visual characteristics', '视觉特征'], phenomenon: ['Phenomenon', '现象'],
  spatial_pattern: ['Spatial pattern', '空间特征'], temporal_pattern: ['Temporal pattern', '时间特征'],
  affected_objects: ['Affected objects', '受影响对象'], summary: ['Summary', '摘要'],
  evidence_id: ['Evidence ID', '证据编号'], type: ['Type', '类型'], source: ['Source', '来源'],
  tool: ['Tool', '工具'], params: ['Parameters', '参数'], file: ['File', '文件'],
  mechanism: ['Mechanism', '原因机制'], blame: ['Location', '定位'], component: ['Component', '组件'],
  location: ['Location', '位置'], invariant_broken: ['Broken invariants', '违反的约束'],
  category_primary: ['Primary category', '主要分类'], category_secondary: ['Secondary category', '次要分类'],
  platform: ['Platform', '平台'], engine: ['Engine', '引擎'], api: ['API', 'API'],
  driver: ['Driver', '驱动'], featureConfiguration: ['Configuration', '功能配置'],
  key_spirv_ids: ['SPIR-V IDs', 'SPIR-V 编号'], main_trigger_id: ['Trigger ID', '触发编号'],
  hlsl_anchor: ['HLSL anchor', 'HLSL 定位'], symbol: ['Symbol', '符号'],
  removed_decorations: ['Removed decorations', '移除的修饰'], decoration: ['Decoration', '修饰'],
};

function isCompactList(value: Value): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length < 60);
}

function StructuredValue({ value, chinese, depth = 0 }: { value: Value; chinese: boolean; depth?: number }) {
  if (value === null || typeof value !== 'object') return <span>{value === null ? 'null' : String(value)}</span>;
  if (depth > 12) return <pre className="knowledge-case-raw">{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) {
    if (!value.length) return <code>[]</code>;
    const compact = isCompactList(value);
    return <ul className={`knowledge-case-values${compact ? ' is-compact' : ''}`}>{value.map((item, index) => (
      <li key={index}><StructuredValue value={item} chinese={chinese} depth={depth + 1} /></li>
    ))}</ul>;
  }
  if (!Object.keys(value).length) return <code>{'{}'}</code>;
  return <dl className="knowledge-case-fields">{Object.entries(value).map(([key, item]) => (
    <div key={key} className={!isCompactList(item) && (typeof item === 'object' && item !== null || String(item).length > 75) ? 'is-wide' : undefined}>
      <dt title={key}>{labels[key]?.[chinese ? 1 : 0] ?? key}</dt>
      <dd><StructuredValue value={item} chinese={chinese} depth={depth + 1} /></dd>
    </div>
  ))}</dl>;
}

function EvidenceItem({ value, chinese }: { value: Record<string, Value>; chinese: boolean }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { summary, evidence_id: id, type, ...details } = value;
  return <article className="knowledge-evidence">
    <div className="knowledge-evidence-heading">
      {id !== undefined && <span className="knowledge-evidence-id"><StructuredValue value={id} chinese={chinese} /></span>}
      {type !== undefined && <span><StructuredValue value={type} chinese={chinese} /></span>}
    </div>
    {summary !== undefined && <div className="knowledge-evidence-summary"><StructuredValue value={summary} chinese={chinese} /></div>}
    {Object.keys(details).length > 0 && <>
      <Button variant="ghost" size="sm" className="knowledge-evidence-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)}>
        {chinese ? '来源与细节' : 'Source & details'}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d={open ? 'm5 15 7-7 7 7' : 'm5 9 7 7 7-7'}/></svg>
      </Button>
      {open && <div id={detailsId} className="knowledge-evidence-details"><StructuredValue value={details} chinese={chinese} /></div>}
    </>}
  </article>;
}

export function CaseChapterContent({ content, chapter }: { content: string; chapter?: string }) {
  const { language } = useI18n();
  const chinese = language === 'zh-CN';
  const value = parseChapterValue(content);
  if (chapter === 'evidence' && Array.isArray(value) && value.length > 0) return <div className="knowledge-evidence-list">
    {value.map((item, index) => item !== null && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length > 0
      ? <EvidenceItem key={index} value={item} chinese={chinese} />
      : <div key={index}><StructuredValue value={item} chinese={chinese} /></div>)}
  </div>;
  if (chapter === 'symptoms' && value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0) {
    const { expected, observed, ...attributes } = value;
    return <div className="knowledge-symptoms">
      <div className="knowledge-symptom-comparison">
        {([['expected', expected], ['observed', observed]] as const).filter(([, item]) => item !== undefined).map(([key, item]) => (
          <div className={`knowledge-symptom ${key}`} key={key}>
            <div className="knowledge-symptom-label">{labels[key][chinese ? 1 : 0]}</div>
            <StructuredValue value={item} chinese={chinese} />
          </div>
        ))}
      </div>
      {Object.keys(attributes).length > 0 && <StructuredValue value={attributes} chinese={chinese} />}
    </div>;
  }
  return value === undefined ? <MessageMarkdown content={content} />
    : <div className="knowledge-case-structured"><StructuredValue value={value} chinese={chinese} /></div>;
}
