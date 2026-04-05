import React from 'react';
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

  const preview = openedCapture?.preview ?? null;
  const previewTitle = openedCapture?.filePath.split(/[\\/]/).pop() || openedCapture?.inputId || t('control.previewWindow');
  const previewSourceLabel = preview?.source === 'framebuffer_screenshot'
    ? t('control.previewSourceFramebuffer')
    : t('control.previewSourceThumbnail');

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

  if (!preview) {
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

  return (
    <div
      className={`opened-capture-preview-window ${preview.source === 'capture_thumbnail' ? 'is-fallback' : 'is-ready'}`}
      data-testid="opened-capture-preview-window"
    >
      <div className="opened-capture-preview-media">
        <img
          className="opened-capture-preview-image"
          src={preview.imageUrl}
          alt={openedCapture?.filePath || t('control.previewWindow')}
        />
      </div>

      <div className="opened-capture-preview-meta">
        <div className="opened-capture-preview-meta-topline">
          <span className="opened-capture-preview-title">{previewTitle}</span>
          <span className={`opened-capture-preview-badge ${preview.source}`}>
            {preview.source === 'capture_thumbnail' ? t('control.previewFallback') : previewSourceLabel}
          </span>
        </div>
        <div className="opened-capture-preview-meta-subline">
          <span>{previewSourceLabel}</span>
          <span className="capture-item-separator">·</span>
          <span>
            {t('control.previewResolution')}
            {' '}
            {preview.width > 0 && preview.height > 0 ? `${preview.width}×${preview.height}` : '--'}
          </span>
        </div>
      </div>
    </div>
  );
};

export default OpenedCapturePreview;
