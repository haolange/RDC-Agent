import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MaterialContextSchema, type MaterialContext } from '@shared/types/materialContext';
import { Button, Input, Textarea } from '../ui';
import { useModalFocus } from '../lib/useModalFocus';
import { useOverlayLayer } from '../lib/overlayStack';
import { useI18n } from '../i18n';
import './MaterialContextEditor.css';

type Region = NonNullable<MaterialContext['region']>;
export const MaterialContextEditor: React.FC<{
  fileName: string; previewUrl: string | null; value?: MaterialContext;
  onSave: (value: MaterialContext) => void; onClose: () => void;
}> = ({ fileName, previewUrl, value, onSave, onClose }) => {
  const { language } = useI18n();
  const zh = language === 'zh-CN';
  const label = (cn: string, en: string) => zh ? cn : en;
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<MaterialContext>(value ?? {});
  const [dimensions, setDimensions] = useState({ width: 1000, height: 1000 });
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [error, setError] = useState('');
  const { layerId } = useOverlayLayer(true);
  useModalFocus({ open: true, containerRef: ref, onClose, layerId });
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
    if (!parsed.success) { setError(label('请检查区域、时间范围及对比条件。', 'Check the region, time range and comparison conditions.')); return; }
    onSave(parsed.data); onClose();
  };
  return createPortal(<div className="material-context-overlay">
    <div className="material-context-editor" ref={ref} role="dialog" aria-modal="true" aria-label={fileName} tabIndex={-1}>
      <h2>{fileName}</h2>
      {previewUrl && <>
        <img className="material-context-probe" src={previewUrl} alt="" onLoad={event => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        <p>{label('拖出关注区域，或聚焦图片后用方向键移动区域。Shift + 方向键调整大小。', 'Drag to mark an area, or focus the image and use arrow keys to move it. Shift + arrows resizes it.')}</p>
        <svg className="material-context-image" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} tabIndex={0} role="application" aria-label={label('选择关注区域', 'Select area of interest')}
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
        <Button variant="ghost" onClick={() => setDraft(current => ({ ...current, region: undefined }))}>{label('使用整张图片', 'Use whole image')}</Button>
      </>}
      <label>{label('哪里不对，希望变成怎样？', 'What looks wrong, and what would you like instead?')}
        <Textarea value={draft.intent ?? ''} onChange={event => setDraft(current => ({ ...current, intent: event.target.value }))} maxLength={2000} />
      </label>
      <details><summary>{label('定位与对比（可选）', 'Location and comparison (optional)')}</summary>
        <label>{label('章节、页码、段落或表格范围', 'Section, page, paragraph or table range')}<Input value={draft.documentLocation ?? ''} onChange={event => setDraft(current => ({ ...current, documentLocation: event.target.value }))} maxLength={1000} /></label>
        <div className="material-context-row">
          <label>{label('起点（秒）', 'Start (seconds)')}<Input type="number" min="0" value={draft.timeRange?.startSeconds ?? ''} onChange={event => setDraft(current => ({ ...current, timeRange: event.target.value === '' ? undefined : { startSeconds: Number(event.target.value), endSeconds: current.timeRange?.endSeconds ?? Number(event.target.value)+1 } }))} /></label>
          <label>{label('终点（秒）', 'End (seconds)')}<Input type="number" min="0" value={draft.timeRange?.endSeconds ?? ''} onChange={event => setDraft(current => ({ ...current, timeRange: event.target.value === '' ? undefined : { startSeconds: current.timeRange?.startSeconds ?? 0, endSeconds: Number(event.target.value) } }))} /></label>
        </div>
        <label>{label('对比用途', 'Comparison role')}<select value={draft.comparison?.role ?? ''} onChange={event => setDraft(current => ({ ...current, comparison: event.target.value ? { group: current.comparison?.group ?? '', conditions: current.comparison?.conditions ?? '', role: event.target.value as NonNullable<MaterialContext['comparison']>['role'] } : undefined }))}>
          <option value="">{label('不作对比', 'No comparison')}</option><option value="baseline">{label('原始状态', 'Baseline')}</option><option value="reference">{label('参考效果', 'Reference')}</option><option value="after">{label('调整之后', 'After')}</option><option value="diff">{label('差异图', 'Difference')}</option>
        </select></label>
        {draft.comparison && <>
          <label>{label('同组材料使用相同名称', 'Use the same name for paired materials')}<Input value={draft.comparison.group} maxLength={120} onChange={event => setDraft(current => ({ ...current, comparison: { ...current.comparison!, group: event.target.value } }))} /></label>
          <label>{label('拍摄、画面或测量条件', 'Capture, image or measurement conditions')}<Textarea value={draft.comparison.conditions} maxLength={2000} onChange={event => setDraft(current => ({ ...current, comparison: { ...current.comparison!, conditions: event.target.value } }))} /></label>
        </>}
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="material-context-actions"><Button variant="ghost" onClick={onClose}>{label('取消', 'Cancel')}</Button><Button onClick={save}>{label('保存说明', 'Save details')}</Button></div>
    </div>
  </div>, document.body);
};
