import React from 'react';
import type { OpenedCaptureState } from '@shared/types/session';
import { useI18n } from '../../i18n';

interface ProjectPreviewProps {
  openedCapture: OpenedCaptureState | null;
  isLoading: boolean;
}

export const ProjectPreview: React.FC<ProjectPreviewProps> = ({
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
      <div className="project-preview-window is-loading" data-testid="project-preview-window">
        <div className="project-preview-art">
          <span className="project-preview-orb orb-a" />
          <span className="project-preview-orb orb-b" />
          <span className="project-preview-orb orb-c" />
        </div>
        <div className="project-preview-empty-copy">
          <div className="project-preview-title">{t('control.previewWindow')}</div>
          <div className="project-preview-status">{t('control.previewLoading')}</div>
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="project-preview-window" data-testid="project-preview-window">
        <div className="project-preview-art">
          <span className="project-preview-orb orb-a" />
          <span className="project-preview-orb orb-b" />
          <span className="project-preview-orb orb-c" />
        </div>
        <div className="project-preview-empty-copy">
          <div className="project-preview-title">{t('control.previewWindow')}</div>
          <div className="project-preview-status">{t('control.previewEmpty')}</div>
          <div className="project-preview-description">
            {openedCapture ? t('control.previewNoImage') : t('control.previewEmptyHint')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`project-preview-window ${preview.source === 'capture_thumbnail' ? 'is-fallback' : 'is-ready'}`}
      data-testid="project-preview-window"
    >
      <div className="project-preview-media">
        <img
          className="project-preview-image"
          src={preview.imageUrl}
          alt={openedCapture?.filePath || t('control.previewWindow')}
        />
      </div>

      <div className="project-preview-meta">
        <div className="project-preview-meta-topline">
          <span className="project-preview-title">{previewTitle}</span>
          <span className={`project-preview-badge ${preview.source}`}>
            {preview.source === 'capture_thumbnail' ? t('control.previewFallback') : previewSourceLabel}
          </span>
        </div>
        <div className="project-preview-meta-subline">
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

export default ProjectPreview;
