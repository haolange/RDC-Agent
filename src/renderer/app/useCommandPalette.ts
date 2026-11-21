import { useEffect, useCallback } from 'react';
import { useCommandPaletteStore } from '../stores/commandPaletteStore';

/** Ctrl/Cmd+K toggles the palette; Escape belongs to the palette's own overlay layer. */
export function useCommandPalette() {
  const { open, setOpen, toggle, query, setQuery } = useCommandPaletteStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  return { open, close, query, setQuery };
}
