import React, { useEffect, useState } from 'react';
import type { OpenedCaptureState } from '@shared/types/session';
import { useI18n } from '../../i18n';

interface OpenedCapturePreviewProps {
  openedCapture: OpenedCaptureState | null;
  isLoading: boolean;
}

export const OpenedCapturePreview: React.FC<OpenedCapturePreviewProps> = ({
  openedCapture,
  isLoading,
}) => {
  const { t } = useI18n();
  const [imageLoadFailed, setImageLoadFailed] = useState(false);

  const preview = openedCapture?.preview ?? null;
  const hasValidPreview = Boolean(preview && !imageLoadFailed);
  const previewTitle = openedCapture?.filePath.split(/[\\/]/).pop() || openedCapture?.inputId || t('control.previewWindow');
  const previewSourceLabel = preview?.source === 'framebuffer_screenshot'
    ? t('control.previewSourceFramebuffer')
    : t('control.previewSourceThumbnail');

  useEffect(() => {
    setImageLoadFailed(false);
  }, [preview?.imageUrl, preview?.updatedAt]);

  if (isLoading) {
    return (
      <div className="opened-capture-preview-window is-loading" data-testid="opened-capture-preview-window">
        <div className="opened-capture-preview-art">
          <span className="opened-capture-preview-orb orb-a" />
          <span className="opened-capture-preview-orb orb-b" />
          <span className="opened-capture-preview-orb orb-c" />
        </div>
        <div className="opened-capture-preview-empty-copy">
          <div className="opened-capture-preview-title">{t('control.previewWindow')}</div>
          <div className="opened-capture-preview-status">{t('control.previewLoading')}</div>
        </div>
      </div>
    );
  }

  if (!hasValidPreview) {
    return (
      <div className="opened-capture-preview-window" data-testid="opened-capture-preview-window">
        <div className="opened-capture-preview-art">
          <span className="opened-capture-preview-orb orb-a" />
          <span className="opened-capture-preview-orb orb-b" />
          <span className="opened-capture-preview-orb orb-c" />
        </div>
        <div className="opened-capture-preview-empty-copy">
          <div className="opened-capture-preview-title">{t('control.previewWindow')}</div>
          <div className="opened-capture-preview-status">{t('control.previewEmpty')}</div>
          <div className="opened-capture-preview-description">
            {openedCapture ? t('control.previewNoImage') : t('control.previewEmptyHint')}
          </div>
        </div>
      </div>
    );
  }

  const resolvedPreview = preview!;

  return (
    <div
      className={`opened-capture-preview-window ${resolvedPreview.source === 'capture_thumbnail' ? 'is-fallback' : 'is-ready'}`}
      data-testid="opened-capture-preview-window"
    >
      <div className="opened-capture-preview-media">
        <img
          className="opened-capture-preview-image"
          src={resolvedPreview.imageUrl}
          alt={openedCapture?.filePath || t('control.previewWindow')}
          onError={() => setImageLoadFailed(true)}
        />
      </div>

      <div className="opened-capture-preview-meta">
        <div className="opened-capture-preview-meta-topline">
          <span className="opened-capture-preview-title" title={previewTitle}>{previewTitle}</span>
          <span className={`opened-capture-preview-badge ${resolvedPreview.source}`}>
            {resolvedPreview.source === 'capture_thumbnail' ? t('control.previewFallback') : previewSourceLabel}
          </span>
        </div>
        <div className="opened-capture-preview-meta-subline">
          <span>{previewSourceLabel}</span>
          <span className="capture-item-separator">/</span>
          <span>
            {t('control.previewResolution')}
            {' '}
            {resolvedPreview.width > 0 && resolvedPreview.height > 0 ? `${resolvedPreview.width}x${resolvedPreview.height}` : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default OpenedCapturePreview;
