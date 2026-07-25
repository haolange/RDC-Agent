import React, { useEffect, useState } from 'react';

interface FaviconImageProps {
  domain: string;
  className?: string;
  alt?: string;
}

const monogramForDomain = (domain: string): string => {
  const host = domain.replace(/^www\./i, '').trim();
  const letter = host.charAt(0);
  return letter ? letter.toUpperCase() : '?';
};

export const FaviconImage: React.FC<FaviconImageProps> = ({
  domain,
  className = '',
  alt = '',
}) => {
  const cleaned = domain.replace(/^https?:\/\//i, '').split('/')[0]?.trim() ?? '';
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [resolved, setResolved] = useState(!cleaned);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setResolved(!cleaned);
    if (!cleaned) {
      return () => {
        cancelled = true;
      };
    }

    void window.electronAPI?.web.resolveFavicon(cleaned)
      .then((result) => {
        if (cancelled) return;
        setDataUrl(result?.dataUrl ?? null);
        setResolved(true);
      })
      .catch(() => {
        if (cancelled) return;
        setDataUrl(null);
        setResolved(true);
      });

    return () => {
      cancelled = true;
    };
  }, [cleaned]);

  if (dataUrl) {
    return (
      <img
        className={`favicon-image ${className}`.trim()}
        src={dataUrl}
        alt={alt}
        width={14}
        height={14}
        loading="lazy"
      />
    );
  }

  if (!resolved) {
    return (
      <span
        className={`favicon-image is-pending ${className}`.trim()}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className={`favicon-image is-monogram ${className}`.trim()}
      aria-hidden="true"
      data-letter={monogramForDomain(cleaned)}
    >
      {monogramForDomain(cleaned)}
    </span>
  );
};
