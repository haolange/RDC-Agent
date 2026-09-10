import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import type { MaterialContext } from '@shared/types/materialContext';
import { Button } from '../ui';
import { useModalFocus } from '../hooks/useModalFocus';
import { useI18n } from '../i18n';
import './MaterialContextEditor.css';

export interface MaterialPreview {
  id: string; name: string; previewUrl?: string; material?: MaterialContext; hash?: string;
}
export const MaterialContextViewer: React.FC<{
  items: MaterialPreview[]; onClose: () => void; onOpenOriginal: (id: string) => void;
}> = ({ items, onClose, onOpenOriginal }) => {
  const ref = useRef<HTMLDivElement>(null);
  const { language } = useI18n(); const zh = language === 'zh-CN';
  useModalFocus({ containerRef: ref, open: true, onClose });
  return createPortal(<div className="material-context-overlay">
    <div ref={ref} className="material-context-editor material-context-viewer" role="dialog" aria-modal="true" aria-label={zh ? '材料与对照' : 'Materials and comparison'} tabIndex={-1}>
      <h2 tabIndex={0}>{zh ? '材料与对照' : 'Materials and comparison'}</h2>
      <p>{zh ? '以下说明由用户提供；对照条件尚未由工具核实。' : 'Details supplied by the user; comparison conditions have not been verified by tools.'}</p>
      <div className="material-context-gallery">{items.map(item => <figure key={item.id}>
        <figcaption>{item.name}</figcaption>
        {item.previewUrl && <div className="material-context-preview">
          <img src={item.previewUrl} alt={item.name} />
          {item.material?.region && <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={zh ? '关注区域' : 'Area of interest'} role="img"><rect {...item.material.region} /></svg>}
        </div>}
        {item.material?.intent && <p>{item.material.intent}</p>}
        {item.material?.documentLocation && <p>{item.material.documentLocation}</p>}
        {item.material?.timeRange && <p>{item.material.timeRange.startSeconds}–{item.material.timeRange.endSeconds} s</p>}
        {item.material?.comparison && <p>{({ baseline: zh ? '基准' : 'Baseline', reference: zh ? '参考' : 'Reference', after: zh ? '调整后' : 'After', diff: zh ? '差异' : 'Difference' })[item.material.comparison.role]} · {item.material.comparison.group}<br />{item.material.comparison.conditions}</p>}
        <Button variant="ghost" onClick={() => onOpenOriginal(item.id)}>{zh ? '打开原文件' : 'Open original'}</Button>
        {item.hash && <details><summary>{zh ? '来源指纹' : 'Source fingerprint'}</summary><code>{item.hash}</code></details>}
      </figure>)}</div>
      <div className="material-context-actions"><Button onClick={onClose}>{zh ? '关闭' : 'Close'}</Button></div>
    </div>
  </div>, document.body);
};
