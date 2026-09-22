import React, { useState } from 'react';
import { MaterialContextSchema, type MaterialContext } from '@shared/types/materialContext';
import { Button, Input, Textarea } from '../ui';
import { TaskDialog } from '../ui/TaskDialog';
import { useI18n } from '../i18n';
import './MaterialContextEditor.css';

type Region = NonNullable<MaterialContext['region']>;
export const MaterialContextEditor: React.FC<{
  fileName: string; previewUrl: string | null; value?: MaterialContext;
  onSave: (value: MaterialContext) => void; onClose: () => void;
}> = ({ fileName, previewUrl, value, onSave, onClose }) => {
  const { t } = useI18n();
  const [draft, setDraft] = useState<MaterialContext>(value ?? {});
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const region = draft.region;
  const changeRegion = (next: Region) => setDraft(current => ({ ...current, region: next }));
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    const matrix = svg.getScreenCTM();
    const local = matrix ? p.matrixTransform(matrix.inverse()) : p;
    return { x: Math.max(0, Math.min(1, local.x / dimensions.width)), y: Math.max(0, Math.min(1, local.y / dimensions.height)) };
  };
  const selectRegion = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!anchor) return;
    const end = point(event);
    const width = Math.abs(end.x - anchor.x); const height = Math.abs(end.y - anchor.y);
    if (width > 0 && height > 0) changeRegion({ x: Math.min(end.x, anchor.x), y: Math.min(end.y, anchor.y), width, height });
  };
  const save = () => {
    const parsed = MaterialContextSchema.safeParse(draft);
    if (!parsed.success) { setError(t('material.validationError')); return; }
    onSave(parsed.data); onClose();
  };
  return <TaskDialog open title={fileName} closeLabel={t('dialog.close')} onClose={onClose}
    className="material-context-editor" dismissOnBackdrop={false}
    footer={<><Button variant="ghost" onClick={onClose}>{t('material.cancel')}</Button><Button onClick={save}>{t('material.save')}</Button></>}>
      {previewUrl && <>
        <img className="material-context-probe" src={previewUrl} alt="" onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        <p>{t('material.regionHelp')}</p>
        <svg className="material-context-image" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} tabIndex={0} role="application" aria-label={t('material.selectRegion')}
          onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setAnchor(point(event)); }}
          onPointerMove={selectRegion} onPointerUp={event => { selectRegion(event); setAnchor(null); }} onPointerCancel={() => setAnchor(null)}
          onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault(); const r = region ?? { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
            const dx = event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0;
            const dy = event.key === 'ArrowUp' ? -0.01 : event.key === 'ArrowDown' ? 0.01 : 0;
            changeRegion(event.shiftKey ? { ...r, width: Math.min(1-r.x, Math.max(0.01,r.width+dx)), height: Math.min(1-r.y,Math.max(0.01,r.height+dy)) } : { ...r, x: Math.min(1-r.width,Math.max(0,r.x+dx)), y: Math.min(1-r.height,Math.max(0,r.y+dy)) });
          }}>
          <image href={previewUrl} width={dimensions.width} height={dimensions.height} />
          {region && <rect x={region.x * dimensions.width} y={region.y * dimensions.height} width={region.width * dimensions.width} height={region.height * dimensions.height} />}
        </svg>
        <Button variant="ghost" onClick={() => setDraft(current => ({ ...current, region: undefined }))}>{t('material.wholeImage')}</Button>
      </>}
      <label>{t('material.intent')}
        <Textarea value={draft.intent ?? ''} onChange={event => setDraft(current => ({ ...current, intent: event.target.value }))} maxLength={2000} />
      </label>
      <details><summary>{t('material.locationAndComparison')}</summary>
        <label>{t('material.documentLocation')}<Input value={draft.documentLocation ?? ''} onChange={event => setDraft(current => ({ ...current, documentLocation: event.target.value }))} maxLength={1000} /></label>
        <div className="material-context-row">
          <label>{t('material.startSeconds')}<Input type="number" min="0" value={draft.timeRange?.startSeconds ?? ''} onChange={event => setDraft(current => ({ ...current, timeRange: event.target.value === '' ? undefined : { startSeconds: Number(event.target.value), endSeconds: current.timeRange?.endSeconds ?? Number(event.target.value)+1 } }))} /></label>
          <label>{t('material.endSeconds')}<Input type="number" min="0" value={draft.timeRange?.endSeconds ?? ''} onChange={event => setDraft(current => ({ ...current, timeRange: event.target.value === '' ? undefined : { startSeconds: current.timeRange?.startSeconds ?? 0, endSeconds: Number(event.target.value) } }))} /></label>
        </div>
        <label>{t('material.comparisonRole')}<select value={draft.comparison?.role ?? ''} onChange={event => setDraft(current => ({ ...current, comparison: event.target.value ? { group: current.comparison?.group ?? '', conditions: current.comparison?.conditions ?? '', role: event.target.value as NonNullable<MaterialContext['comparison']>['role'] } : undefined }))}>
          <option value="">{t('material.noComparison')}</option><option value="baseline">{t('material.baseline')}</option><option value="reference">{t('material.reference')}</option><option value="after">{t('material.after')}</option><option value="diff">{t('material.diff')}</option>
        </select></label>
        {draft.comparison && <>
          <label>{t('material.comparisonGroup')}<Input value={draft.comparison.group} maxLength={120} onChange={event => setDraft(current => ({ ...current, comparison: { ...current.comparison!, group: event.target.value } }))} /></label>
          <label>{t('material.comparisonConditions')}<Textarea value={draft.comparison.conditions} maxLength={2000} onChange={event => setDraft(current => ({ ...current, comparison: { ...current.comparison!, conditions: event.target.value } }))} /></label>
        </>}
      </details>
      {error && <p role="alert">{error}</p>}
  </TaskDialog>;
};
