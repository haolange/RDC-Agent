import React, { useMemo } from 'react';
import { useCommandPalette } from './useCommandPalette';
import { useI18n } from '../../i18n';

interface CommandPaletteProps {
  onExecute?: (command: string) => void;
}

const BUILTIN_COMMANDS = [
  { name: '/help', description: 'Show available commands' },
  { name: '/clear', description: 'Clear current conversation' },
  { name: '/status', description: 'Show system status' },
  { name: '/config', description: 'Open settings' },
  { name: '/mode', description: 'Switch agent mode' },
  { name: '/model', description: 'Switch conversation model, or use the Agent configuration' },
  { name: '/compact', description: 'Compact conversation context' },
  { name: '/undo', description: 'Undo last user message' },
];

export const CommandPalette: React.FC<CommandPaletteProps> = ({ onExecute }) => {
  const { open, close, query, setQuery } = useCommandPalette();
  const { t } = useI18n();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return BUILTIN_COMMANDS;
    return BUILTIN_COMMANDS.filter(
      (c) => c.name.includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [query]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onClick={close}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-input-wrap">
          <span className="command-palette-prompt">{'>'}</span>
          <input
            className="command-palette-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('app.inputPlaceholder')}
            aria-label="Command palette input"
          />
        </div>
        <div className="command-palette-list">
          {filtered.map((cmd) => (
            <button
              key={cmd.name}
              type="button"
              className="command-palette-item"
              title={cmd.description}
              onClick={() => {
                onExecute?.(cmd.name);
                close();
              }}
            >
              <span className="command-palette-name">{cmd.name}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
};
