import React, { useEffect, useState } from 'react';
import type { ConversationToolImagePreviewRef } from '@shared/types/conversation';
import { useI18n } from '../../../i18n';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useProjectStore } from '../../../stores/projectStore';

export const WorkProcessImageThumbs: React.FC<{ previews: ConversationToolImagePreviewRef[] }> = ({
  previews,
}) => {
  const { t } = useI18n();
  const sessionId = useProjectStore((state) => state.currentSession?.sessionId);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openSrc, setOpenSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId || previews.length === 0) return;
    let cancelled = false;
    const api = getElectronApi();
    void Promise.all(previews.map(async (preview) => {
      const result = await api?.conversation.getToolImagePreview({ sessionId, previewId: preview.previewId });
      return [preview.previewId, result?.dataUrl ?? ''] as const;
    })).then((entries) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter(([, url]) => url)));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, previews]);

  useEffect(() => {
    if (!openSrc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpenSrc(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openSrc]);

  if (previews.length === 0) return null;
  return (
    <div className="work-process-tool-thumbs" data-testid="work-process-image-thumbs">
      {previews.map((preview) => {
        const src = urls[preview.previewId];
        return src ? (
          <button
            key={preview.previewId}
            type="button"
            className="work-process-tool-thumb-button"
            onClick={() => setOpenSrc(src)}
            title={preview.fileName}
          >
            <img className="work-process-tool-thumb" src={src} alt={preview.fileName} />
          </button>
        ) : (
          <span key={preview.previewId} className="work-process-tool-thumb is-pending" title={preview.fileName}>
            {preview.fileName.slice(0, 1).toUpperCase()}
          </span>
        );
      })}
      {openSrc ? (
        <button
          type="button"
          className="work-process-tool-lightbox"
          onClick={() => setOpenSrc(null)}
          aria-label={t('chat.workProcessCloseImage')}
        >
          <img className="work-process-tool-lightbox-image" src={openSrc} alt="" />
        </button>
      ) : null}
    </div>
  );
};
