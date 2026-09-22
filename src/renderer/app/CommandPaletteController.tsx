import { CommandPalette } from '../patterns/CommandPalette';
import { useCommandPalette } from './useCommandPalette';

export function CommandPaletteController({ onExecute }: { onExecute?: (command: string) => void }) {
  const palette = useCommandPalette();
  return <CommandPalette {...palette} onExecute={onExecute} />;
}
