import { useEffect, useState } from 'react';

const isViewportNarrow = (maxWidth: number): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= maxWidth || window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
};

export const useNarrowViewport = (maxWidth: number): boolean => {
  const [narrow, setNarrow] = useState(() => isViewportNarrow(maxWidth));

  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const sync = () => setNarrow(isViewportNarrow(maxWidth));
    sync();
    media.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      media.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, [maxWidth]);

  return narrow;
};
