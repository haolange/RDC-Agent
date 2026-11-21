import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ImageViewer, type ImageViewerItem } from '../../ui/ImageViewer';
import { Skeleton } from '../../ui/Skeleton';
import { useMarkdownSourceScope } from './markdownSources';
import { useMarkdownMedia } from './useMarkdownMedia';

interface GalleryControl {
  open: (from: HTMLElement) => void;
}

const GalleryContext = createContext<GalleryControl | null>(null);

/**
 * One viewer per rendered Markdown body. Opening reads the body's images in document order, so previous / next walk
 * the answer's images the way a reader sees them.
 */
export const MarkdownGallery: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [view, setView] = useState<{ items: ImageViewerItem[]; originals: (string | undefined)[]; index: number } | null>(null);
  const open = useCallback((from: HTMLElement) => {
    const body = from.closest('.markdown-body') ?? from.parentElement;
    const images = [...(body?.querySelectorAll<HTMLImageElement>('img.markdown-media-image') ?? [])];
    const index = Math.max(0, images.findIndex((image) => from.contains(image)));
    setView({
      items: images.map((image) => ({ src: image.src, title: image.alt })),
      originals: images.map((image) => image.dataset.original),
      index,
    });
  }, []);
  const control = useMemo(() => ({ open }), [open]);
  const originals = view?.originals ?? [];
  return (
    <GalleryContext.Provider value={control}>
      {children}
      <ImageViewer open={Boolean(view)} items={view?.items ?? []} index={view?.index ?? 0}
        onIndexChange={(index) => setView((current) => (current ? { ...current, index } : current))}
        onClose={() => setView(null)}
        onOpenOriginal={originals[view?.index ?? 0] ? (index) => { window.open(originals[index], '_blank', 'noopener'); } : undefined} />
    </GalleryContext.Provider>
  );
};

/**
 * An image or video an answer embeds. Remote images come through the main-process fetch and local references through
 * the session's media channel; both arrive as object URLs. A reference that cannot resolve leaves only its alt text.
 */
export const MarkdownMedia: React.FC<{ src?: string; alt?: string }> = ({ src, alt = '' }) => {
  const { sessionId } = useMarkdownSourceScope();
  const media = useMarkdownMedia(src, sessionId);
  const gallery = useContext(GalleryContext);
  if (media.status === 'loading') return <Skeleton shape="block" inline className="markdown-media-skeleton" />;
  if (media.status === 'unavailable') return alt ? <span className="markdown-media-missing">{alt}</span> : null;
  if (media.kind === 'video') {
    return (
      <span className="markdown-media" role="figure" aria-label={alt || undefined}>
        <video className="markdown-media-video" src={media.url} controls preload="metadata" />
        {alt ? <span className="markdown-media-caption">{alt}</span> : null}
      </span>
    );
  }
  return (
    <span className="markdown-media" role="figure" aria-label={alt || undefined}>
      <button type="button" className="markdown-media-open" onClick={(event) => gallery?.open(event.currentTarget)}>
        <img className="markdown-media-image" src={media.url} alt={alt}
          data-original={src?.startsWith('https://') ? src : undefined} />
      </button>
      {alt ? <span className="markdown-media-caption">{alt}</span> : null}
    </span>
  );
};
