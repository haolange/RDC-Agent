import type { KnowledgeImageRole } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { knowledgeImageRoleLabelKey, normalizeKnowledgePreviewPath } from '../knowledgeCardImages';
import { useKnowledgeCardImage } from '../useKnowledgeCardImage';

interface KnowledgeCardImageProps {
  spaceId: string;
  relativePath: string;
  role?: KnowledgeImageRole;
  alt?: string;
  caption?: string;
}

export function KnowledgeCardImage({
  spaceId,
  relativePath,
  role,
  alt,
  caption,
}: KnowledgeCardImageProps) {
  const { t } = useI18n();
  const preview = useKnowledgeCardImage(spaceId, relativePath);
  const path = normalizeKnowledgePreviewPath(relativePath);
  const roleLabel = role ? t(knowledgeImageRoleLabelKey(role)) : undefined;
  const heading = caption ?? roleLabel;
  const ready = preview.status === 'ready';

  return (
    <figure
      className={`knowledge-card-image${ready ? '' : ' is-missing'}${preview.status === 'loading' ? ' is-loading' : ''}`}
      data-testid="knowledge-card-image"
      data-role={role}
      data-path={path}
    >
      {heading ? <figcaption className="knowledge-card-image-label">{heading}</figcaption> : null}
      <div className="knowledge-card-image-frame">
        {ready ? (
          <img src={preview.dataUrl} alt={alt ?? heading ?? path} />
        ) : (
          <div className="knowledge-card-image-missing" role="img" aria-label={t('knowledgeCenter.imageMissing')}>
            <span>{t('knowledgeCenter.imageMissing')}</span>
            <code>{path}</code>
          </div>
        )}
      </div>
    </figure>
  );
}
