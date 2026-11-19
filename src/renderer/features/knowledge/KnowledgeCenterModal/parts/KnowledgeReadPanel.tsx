import { useState } from 'react';
import type { KnowledgeReadRequest, KnowledgeReadResult } from '@shared/types/knowledge';
import { Button } from '../../../../ui/Button';
import { Input } from '../../../../ui/Input';
import { Select } from '../../../../ui/Select';
import { Tabs } from '../../../../ui/Tabs';
import { useI18n } from '../../../../i18n';
import { KnowledgeMarkdown } from './KnowledgeMarkdown';

type Selection = Pick<KnowledgeReadRequest, 'mode' | 'heading' | 'headingLine' | 'startLine' | 'endLine'>;
export function KnowledgeReadPanel({ reading, onRead, busy }: { reading: KnowledgeReadResult; onRead: (selection: Selection) => Promise<void>; busy: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Selection['mode']>('summary');
  const [headingLine, setHeadingLine] = useState(String(reading.headings[0]?.line ?? ''));
  const [start, setStart] = useState('1');
  const [end, setEnd] = useState(String(Math.min(100, reading.lineCount)));
  const heading = reading.headings.find(item => String(item.line) === headingLine);
  const startLine = Number(start), endLine = Number(end);
  const validRange = Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine && endLine <= reading.lineCount;
  const read = () => {
    if (mode === 'section' && heading) return onRead({ mode, heading: heading.title, headingLine: heading.line });
    if (mode === 'range' && validRange) return onRead({ mode, startLine, endLine });
    return onRead({ mode });
  };
  return (
    <>
      <Tabs label={t('knowledgeCenter.readMode')} value={mode} onChange={value => setMode(value as Selection['mode'])} tabs={[
        { id: 'summary', label: t('knowledgeCenter.readSummary') },
        { id: 'section', label: t('knowledgeCenter.readSection') },
        { id: 'range', label: t('knowledgeCenter.readLines') },
        { id: 'full', label: t('knowledgeCenter.readFull') },
      ].map(tab => ({ ...tab, disabled: busy }))} />
      {mode === 'section' ? (
        <Select dataTestId="knowledge-read-heading" ariaLabel={t('knowledgeCenter.readSection')} value={headingLine} disabled={busy}
          onChange={setHeadingLine} options={reading.headings.map(item => ({ value: String(item.line), label: `${item.title} · ${item.line}` }))} />
      ) : null}
      {mode === 'range' ? (
        <>
          <label className="knowledge-center-field"><span>{t('knowledgeCenter.readStartLine')}</span>
            <Input type="number" min={1} max={reading.lineCount} value={start} disabled={busy} onChange={event => setStart(event.target.value)} />
          </label>
          <label className="knowledge-center-field"><span>{t('knowledgeCenter.readEndLine')}</span>
            <Input type="number" min={1} max={reading.lineCount} value={end} disabled={busy} onChange={event => setEnd(event.target.value)} />
          </label>
        </>
      ) : null}
      <Button variant="secondary" size="sm" disabled={busy || (mode === 'section' && !heading) || (mode === 'range' && !validRange)}
        onClick={() => void read()} data-testid="knowledge-read-submit">{t('knowledgeCenter.readRun')}</Button>
      <p className="knowledge-write-hint">{t('knowledgeCenter.readCurrentRange')}: {reading.range} · {reading.lineCount}</p>
      <KnowledgeMarkdown content={reading.content} spaceId={reading.card.spaceId} />
    </>
  );
}
