import React, { useState } from 'react';

interface FaviconImageProps {
  domain: string;
  className?: string;
  alt?: string;
}

export function resolveFaviconUrl(domain: string): string {
  const cleaned = domain.replace(/^https?:\/\//i, '').split('/')[0]?.trim() ?? '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleaned || 'example.com')}&sz=32`;
}

export const FaviconImage: React.FC<FaviconImageProps> = ({
  domain,
  className = '',
  alt = '',
}) => {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return (
      <span className={`favicon-image is-fallback ${className}`.trim()} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
      </span>
    );
  }
  return (
    <img
      className={`favicon-image ${className}`.trim()}
      src={resolveFaviconUrl(domain)}
      alt={alt}
      width={14}
      height={14}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
};
