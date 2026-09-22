import { useEffect, useCallback } from 'react';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';

export function useCommandPalette() {
  const { open, setOpen, toggle, query, setQuery } = useCommandPaletteStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
        event.preventDefault();
        toggle();
      }
      if (event.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, toggle, setOpen]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  return { open, close, query, setQuery };
}
