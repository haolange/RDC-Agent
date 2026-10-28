import React, { useState } from 'react';
import type { ConversationToolImagePreviewRef } from '@shared/types/conversation';
import { useI18n } from '../../i18n';
import { useToolImagePreviews } from '../../hooks/useToolImagePreviews';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../../ui/Button';
import { TaskDialog } from '../../ui/TaskDialog';

export const WorkProcessImageThumbs: React.FC<{ previews: ConversationToolImagePreviewRef[] }> = ({ previews }) => {
  const { t } = useI18n();
  const sessionId = useProjectStore(state => state.currentSession?.sessionId);
  const { values, retry } = useToolImagePreviews(sessionId, previews);
  const [opened, setOpened] = useState<{ id: string; scope?: string } | null>(null);
  const current = opened?.scope === sessionId ? previews.find(preview => preview.previewId === opened?.id) : undefined;
  const src = current && values[current.previewId]?.url;
  if (!previews.length) return null;
  return <div className="work-process-tool-thumbs" data-testid="work-process-image-thumbs">
    {previews.map((preview, index) => {
      const value = values[preview.previewId];
      return value?.url ? <Button key={`${preview.previewId}:${index}`} variant="ghost" className="work-process-tool-thumb-button"
        aria-label={t('chat.imageOpen', { name: preview.fileName })} title={preview.fileName}
        onClick={() => setOpened({ id: preview.previewId, scope: sessionId })}>
        <img className="work-process-tool-thumb" src={value.url} alt={preview.fileName} />
      </Button> : <span key={`${preview.previewId}:${index}`} className="work-process-tool-thumb is-pending" role="status">
        {value?.failed ? <Button variant="ghost" size="sm" onClick={() => retry(preview.previewId)}
          aria-label={t('chat.imageRetry', { name: preview.fileName })}>{t('chat.imageUnavailable')}</Button> : t('chat.imageLoading')}
      </span>;
    })}
    {current && src ? <TaskDialog open title={current.fileName} className="tool-image-preview-dialog"
      size="lg" closeLabel={t('chat.workProcessCloseImage')} onClose={() => setOpened(null)}>
      <img title={current.fileName} className="work-process-tool-preview-image" src={src} alt={current.fileName} />
    </TaskDialog> : null}
  </div>;
};
