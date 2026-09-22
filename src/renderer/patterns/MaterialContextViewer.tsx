import React from 'react';
import type { MaterialContext } from '@shared/types/materialContext';
import { Button } from '../ui';
import { TaskDialog } from '../ui/TaskDialog';
import { useI18n } from '../i18n';
import './MaterialContextEditor.css';

export interface MaterialPreview {
  id: string; name: string; previewUrl?: string; material?: MaterialContext; hash?: string;
}
export const MaterialContextViewer: React.FC<{
  items: MaterialPreview[]; onClose: () => void; onOpenOriginal: (id: string) => void;
}> = ({ items, onClose, onOpenOriginal }) => {
  const { t } = useI18n();
  return <TaskDialog open title={t('material.viewerTitle')} closeLabel={t('dialog.close')} onClose={onClose}
    className="material-context-editor material-context-viewer" dismissOnBackdrop={false}
    description={t('material.userSuppliedNote')}
    footer={<Button onClick={onClose}>{t('dialog.close')}</Button>}>
      <div className="material-context-gallery">{items.map(item => <figure key={item.id}>
        <figcaption>{item.name}</figcaption>
        {item.previewUrl && <div className="material-context-preview">
          <img src={item.previewUrl} alt={item.name} />
          {item.material?.region && <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={t('material.area')} role="img"><rect {...item.material.region} /></svg>}
        </div>}
        {item.material?.intent && <p>{item.material.intent}</p>}
        {item.material?.documentLocation && <p>{item.material.documentLocation}</p>}
        {item.material?.timeRange && <p>{item.material.timeRange.startSeconds}–{item.material.timeRange.endSeconds} s</p>}
        {item.material?.comparison && <p>{({ baseline: t('material.viewerBaseline'), reference: t('material.viewerReference'), after: t('material.viewerAfter'), diff: t('material.viewerDiff') })[item.material.comparison.role]} · {item.material.comparison.group}<br />{item.material.comparison.conditions}</p>}
        <Button variant="ghost" onClick={() => onOpenOriginal(item.id)}>{t('material.openOriginal')}</Button>
        {item.hash && <details><summary>{t('material.fingerprint')}</summary><code>{item.hash}</code></details>}
      </figure>)}</div>
  </TaskDialog>;
};
