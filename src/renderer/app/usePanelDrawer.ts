import { useCallback, useEffect, useState } from 'react';

export function usePanelDrawer(isAvailable: boolean) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isAvailable) setIsOpen(false);
  }, [isAvailable]);

  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    if (isAvailable) setIsOpen((open) => !open);
  }, [isAvailable]);

  return { isOpen, close, toggle };
}
