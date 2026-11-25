import React from 'react';
import { resolveFaviconDataUrl } from '../hooks/appShellBridge';
import { useAsyncValue } from '../lib/useAsyncValue';

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
  const favicon = useAsyncValue(cleaned || null, () => resolveFaviconDataUrl(cleaned));
  const dataUrl = favicon.status === 'ready' ? favicon.value : null;
  // A failed lookup shows the monogram, like a domain without an icon.
  const resolved = favicon.status !== 'loading';

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
