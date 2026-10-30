import type { CommandListResult } from '@shared/types/command';
import React, { useMemo } from 'react';
import { useI18n } from '../../i18n';

interface CommandPaletteProps {
  commands: CommandListResult['commands'];
  loading?: boolean;
  error?: string | null;
  open: boolean;
  close: () => void;
  query: string;
  setQuery: (query: string) => void;
  onExecute?: (command: string) => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, loading, error, open, close, query, setQuery, onExecute }) => {
  const { t } = useI18n();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.name.includes(q) || c.description.toLowerCase().includes(q),
    );
  }, [query, commands]);

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
            aria-label={t('app.commandPaletteInput')}
          />
        </div>
        <div className="command-palette-list">
          {loading ? <p role="status">{t('app.commandsLoading')}</p> : null}
          {error ? <p role="alert">{t('app.commandsFailed')}: {error}</p> : null}
          {filtered.map((cmd) => (
            <button
              key={cmd.name}
              type="button"
              className="command-palette-item"
              title={cmd.description}
              onClick={() => {
                onExecute?.(`/${cmd.name}`);
                close();
              }}
            >
              <span className="command-palette-name">/{cmd.name}</span>
            </button>
          ))}
          {!loading && !error && filtered.length === 0 && (
            <div className="command-palette-empty">{t('app.noMatchingCommands')}</div>
          )}
        </div>
      </div>
    </div>
  );
};
