import { useEffect, useState } from 'react';
import { useI18n } from '../../../../i18n';
import { ImageViewer } from '../../../../ui/ImageViewer';
import { Skeleton } from '../../../../ui/Skeleton';
import { knowledgeImageRoleLabelKey, normalizeKnowledgePreviewPath } from '../knowledgeCardImages';
import { useKnowledgeCardImage } from '../useKnowledgeCardImage';
import type { KnowledgeImageRole } from '@shared/types/knowledge';

interface KnowledgeCardImageProps {
  spaceId: string;
  relativePath: string;
  role?: KnowledgeImageRole;
  alt?: string;
  caption?: string;
  /** A card gallery collects loaded images and owns one viewer; an inline illustration opens its own. */
  onReady?: (relativePath: string, url: string) => void;
  onOpen?: (relativePath: string) => void;
}

export function KnowledgeCardImage({
  spaceId,
  relativePath,
  role,
  alt,
  caption,
  onReady,
  onOpen,
}: KnowledgeCardImageProps) {
  const { t } = useI18n();
  const preview = useKnowledgeCardImage(spaceId, relativePath);
  const path = normalizeKnowledgePreviewPath(relativePath);
  const roleLabel = role ? t(knowledgeImageRoleLabelKey(role)) : undefined;
  const heading = caption ?? roleLabel;
  const imageLabel = alt || heading || t('knowledgeCenter.imageRole.illustration');
  const ready = preview.status === 'ready';
  const url = ready ? preview.dataUrl : undefined;
  const [viewing, setViewing] = useState(false);
  useEffect(() => {
    if (url) onReady?.(relativePath, url);
  }, [url, relativePath, onReady]);

  return (
    <figure className="knowledge-card-image" data-testid="knowledge-card-image" data-role={role} data-path={path}>
      {heading ? <figcaption className="knowledge-card-image-label">{heading}</figcaption> : null}
      <div className="knowledge-card-image-frame">
        {ready ? (
          <button
            type="button"
            className="knowledge-card-image-open"
            aria-label={t('knowledgeCenter.imageOpen', { name: heading || imageLabel })}
            onClick={() => (onOpen ? onOpen(relativePath) : setViewing(true))}
          >
            <img src={preview.dataUrl} alt={imageLabel} />
          </button>
        ) : preview.status === 'loading' || preview.status === 'idle' ? (
          <div className="knowledge-card-image-missing" role="status" aria-label={t('knowledgeCenter.loading')}>
            <Skeleton shape="line" count={2} />
          </div>
        ) : (
          <div className="knowledge-card-image-missing" role="img" aria-label={t('knowledgeCenter.imageMissing')}>
            <span>{t('knowledgeCenter.imageMissing')}</span>
          </div>
        )}
      </div>
      {!onOpen && url ? (
        <ImageViewer
          open={viewing}
          items={[{ src: url, title: imageLabel }]}
          index={0}
          onIndexChange={() => undefined}
          onClose={() => setViewing(false)}
        />
      ) : null}
    </figure>
  );
}
