import type { KnowledgeImageRef } from '@shared/types/knowledge';
import { useI18n } from '../../../../i18n';
import { groupKnowledgeImages } from '../knowledgeCardImages';
import { KnowledgeCardImage } from './KnowledgeCardImage';

interface KnowledgeCardImagesProps {
  spaceId: string;
  images: readonly KnowledgeImageRef[];
}

export function KnowledgeCardImages({ spaceId, images }: KnowledgeCardImagesProps) {
  const { t } = useI18n();
  if (images.length === 0) return null;
  const { pairs, singles } = groupKnowledgeImages(images);

  return (
    <div className="knowledge-card-images" data-testid="knowledge-card-images">
      {pairs.map((pair) => (
        <div className="knowledge-card-images-pair" key={`${pair.observed.relativePath}:${pair.reference.relativePath}`}>
          <KnowledgeCardImage
            spaceId={spaceId}
            relativePath={pair.observed.relativePath}
            role="observed"
            alt={pair.observed.alt}
            caption={t('knowledgeCenter.imageBefore')}
          />
          <KnowledgeCardImage
            spaceId={spaceId}
            relativePath={pair.reference.relativePath}
            role="reference"
            alt={pair.reference.alt}
            caption={t('knowledgeCenter.imageAfter')}
          />
        </div>
      ))}
      {singles.map((image) => (
        <KnowledgeCardImage
          key={image.relativePath}
          spaceId={spaceId}
          relativePath={image.relativePath}
          role={image.role}
          alt={image.alt}
        />
      ))}
    </div>
  );
}
