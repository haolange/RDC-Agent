import React, { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { useToolImagePreviews } from '../../hooks/useToolImagePreviews';
import { useProjectStore } from '../../stores/projectStore';
import { Button } from '../../ui/Button';
import { ImageViewer } from '../../ui/ImageViewer';
import type { ConversationToolImagePreviewRef } from '@shared/types/conversation';

/** A file name read as a caption: no extension, separators as spaces. */
export const humanImageTitle = (fileName: string): string =>
  fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || fileName;

export const WorkProcessImageThumbs: React.FC<{ previews: ConversationToolImagePreviewRef[] }> = ({ previews }) => {
  const { t } = useI18n();
  const sessionId = useProjectStore((state) => state.currentSessionId) ?? undefined;
  const { values, retry } = useToolImagePreviews(sessionId, previews);
  const [opened, setOpened] = useState<{ id: string; scope?: string } | null>(null);
  // Only loaded images join the viewer; the session scope keeps a viewer from following the user into another session.
  const items = useMemo(
    () =>
      previews.flatMap((preview) => {
        const url = values[preview.previewId]?.url;
        return url ? [{ id: preview.previewId, src: url, title: humanImageTitle(preview.fileName) }] : [];
      }),
    [previews, values],
  );
  const index = opened?.scope === sessionId ? items.findIndex((item) => item.id === opened?.id) : -1;
  if (!previews.length) return null;
  return (
    <div className="work-process-tool-thumbs" data-testid="work-process-image-thumbs">
      {previews.map((preview, index) => {
        const value = values[preview.previewId];
        return value?.url ? (
          <Button
            key={`${preview.previewId}:${index}`}
            variant="ghost"
            className="work-process-tool-thumb-button"
            aria-label={t('chat.imageOpen', { name: preview.fileName })}
            data-tooltip={preview.fileName}
            onClick={() => setOpened({ id: preview.previewId, scope: sessionId })}
          >
            <img className="work-process-tool-thumb" src={value.url} alt={preview.fileName} />
          </Button>
        ) : (
          <span key={`${preview.previewId}:${index}`} className="work-process-tool-thumb is-pending" role="status">
            {value?.failed ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => retry(preview.previewId)}
                aria-label={t('chat.imageRetry', { name: preview.fileName })}
              >
                {t('chat.imageUnavailable')}
              </Button>
            ) : (
              t('chat.imageLoading')
            )}
          </span>
        );
      })}
      <ImageViewer
        open={index >= 0}
        items={items}
        index={Math.max(0, index)}
        onIndexChange={(next) => setOpened({ id: items[next].id, scope: sessionId })}
        onClose={() => setOpened(null)}
      />
    </div>
  );
};
