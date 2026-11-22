import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '../../../../i18n';
import { ImageViewer } from '../../../../ui/ImageViewer';
import { groupKnowledgeImages, knowledgeImageRoleLabelKey } from '../knowledgeCardImages';
import { KnowledgeCardImage } from './KnowledgeCardImage';
import type { KnowledgeImageRef } from '@shared/types/knowledge';

interface KnowledgeCardImagesProps {
  spaceId: string;
  images: readonly KnowledgeImageRef[];
}

export function KnowledgeCardImages({ spaceId, images }: KnowledgeCardImagesProps) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState<Readonly<Record<string, string>>>({});
  const [opened, setOpened] = useState<string | null>(null);
  const { pairs, singles } = groupKnowledgeImages(images);
  const markReady = useCallback((relativePath: string, url: string) => {
    setLoaded((current) => (current[relativePath] === url ? current : { ...current, [relativePath]: url }));
  }, []);
  // The viewer walks the loaded images in reading order: each before / after pair, then the singles.
  const items = useMemo(() => [
    ...pairs.flatMap((pair) => [
      { path: pair.observed.relativePath, title: pair.observed.alt ?? t('knowledgeCenter.imageBefore') },
      { path: pair.reference.relativePath, title: pair.reference.alt ?? t('knowledgeCenter.imageAfter') },
    ]),
    ...singles.map((image) => ({ path: image.relativePath, title: image.alt ?? t(knowledgeImageRoleLabelKey(image.role)) })),
  ].flatMap((item) => (loaded[item.path] ? [{ ...item, src: loaded[item.path] }] : [])), [pairs, singles, loaded, t]);
  const index = items.findIndex((item) => item.path === opened);
  if (images.length === 0) return null;

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
            onReady={markReady}
            onOpen={setOpened}
          />
          <KnowledgeCardImage
            spaceId={spaceId}
            relativePath={pair.reference.relativePath}
            role="reference"
            alt={pair.reference.alt}
            caption={t('knowledgeCenter.imageAfter')}
            onReady={markReady}
            onOpen={setOpened}
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
          onReady={markReady}
          onOpen={setOpened}
        />
      ))}
      <ImageViewer open={index >= 0} items={items} index={Math.max(0, index)}
        onIndexChange={(next) => setOpened(items[next].path)} onClose={() => setOpened(null)} />
    </div>
  );
}
