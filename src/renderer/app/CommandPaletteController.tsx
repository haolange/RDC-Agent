import { useCommandCatalog } from '../hooks/useCommandCatalog';
import { CommandPalette } from '../patterns/CommandPalette';
import { useCommandPalette } from './useCommandPalette';

export function CommandPaletteController({ onExecute }: { onExecute?: (command: string) => void }) {
  const palette = useCommandPalette();
  const catalog = useCommandCatalog(palette.open);
  return <CommandPalette {...catalog} {...palette} onExecute={onExecute} />;
}
