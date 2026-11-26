import React, { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../lib/ime';
import { useOverlayLayer } from '../../lib/overlayStack';
import { useModalFocus } from '../../lib/useModalFocus';
import { Icon, type IconName } from '../../ui/Icon';
import { InlineError } from '../../ui/InlineError';
import { Skeleton } from '../../ui/Skeleton';
import { usePresence } from '../../ui/usePresence';
import type { LocalizedCommand } from '../../lib/commandLabels';
import './CommandPalette.css';

interface CommandPaletteProps {
  commands: LocalizedCommand[];
  loading?: boolean;
  error?: string | null;
  open: boolean;
  close: () => void;
  query: string;
  setQuery: (query: string) => void;
  onExecute?: (command: string) => void;
}

/** One icon per command category; an unknown category reads as a plain command. */
const CATEGORY_ICONS: Record<string, IconName> = {
  workflow: 'lightning',
  navigation: 'link',
  system: 'nav-general',
  debug: 'tool',
  edit: 'edit',
  session: 'tasks',
};

/**
 * Ctrl/Cmd+K: a centered panel with its own search line and the commands grouped by category, each row an icon,
 * the command and one line of what it does. Arrow keys move, Enter runs, Escape closes; it fades in and out.
 * It is a modal layer: focus starts in the search line, Tab stays inside, and closing returns focus to where it was.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  commands,
  loading,
  error,
  open,
  close,
  query,
  setQuery,
  onExecute,
}) => {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, overlayRef);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { layerId } = useOverlayLayer(open, 'layout');
  useModalFocus({ open, containerRef: dialogRef, onClose: close, layerId });

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^\//u, '');
    const matches = needle
      ? commands.filter(
          (command) =>
            command.name.includes(needle) ||
            command.aliases.some((alias) => alias.includes(needle)) ||
            command.description.toLowerCase().includes(needle),
        )
      : commands;
    const byCategory = new Map<string, LocalizedCommand[]>();
    for (const command of matches)
      byCategory.set(command.categoryLabel, [...(byCategory.get(command.categoryLabel) ?? []), command]);
    return [...byCategory.entries()];
  }, [commands, query]);
  const ordered = useMemo(() => groups.flatMap(([, entries]) => entries), [groups]);

  useEffect(() => setSelectedIndex(0), [query, open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!presence.mounted) return null;

  const run = (command: LocalizedCommand) => {
    onExecute?.(`/${command.name}`);
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((current) => (ordered.length ? (current + step + ordered.length) % ordered.length : 0));
    } else if (event.key === 'Enter' && ordered[selectedIndex]) {
      event.preventDefault();
      run(ordered[selectedIndex]);
    }
  };

  return createPortal(
    <div
      ref={overlayRef}
      className="command-palette-overlay"
      data-state={presence.state}
      onClick={close}
      data-testid="command-palette"
    >
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={t('app.commandPaletteInput')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-palette-search">
          <Icon name="search" size={16} />
          <input
            className="command-palette-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('app.commandPalettePlaceholder')}
            aria-label={t('app.commandPaletteInput')}
            aria-controls="command-palette-list"
            aria-activedescendant={
              ordered[selectedIndex] ? `command-palette-item-${ordered[selectedIndex].id}` : undefined
            }
            role="combobox"
            aria-expanded="true"
            spellCheck={false}
          />
        </div>
        <div
          ref={listRef}
          id="command-palette-list"
          className="command-palette-list scrollbar-thin"
          role="listbox"
          aria-label={t('app.commandPaletteInput')}
        >
          {loading ? (
            <div className="command-palette-state" role="status">
              <Skeleton shape="row" count={4} />
            </div>
          ) : null}
          {error ? (
            <div className="command-palette-state">
              <InlineError detail={error}>{t('app.commandsFailed')}</InlineError>
            </div>
          ) : null}
          {!loading && !error && ordered.length === 0 ? (
            <div className="command-palette-empty">{t('app.noMatchingCommands')}</div>
          ) : null}
          {!loading && !error
            ? groups.map(([category, entries]) => (
                <div key={category} className="command-palette-group" role="group" aria-label={category}>
                  <p className="command-palette-group-label">{category}</p>
                  {entries.map((command) => {
                    const index = ordered.indexOf(command);
                    const selected = index === selectedIndex;
                    return (
                      <div
                        key={command.id}
                        id={`command-palette-item-${command.id}`}
                        className={`command-palette-item${selected ? ' is-selected' : ''}`}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => setSelectedIndex(index)}
                        onClick={() => run(command)}
                      >
                        <Icon
                          name={CATEGORY_ICONS[command.category] ?? 'code'}
                          size={16}
                          className="command-palette-item-icon"
                        />
                        <span className="command-palette-item-name">/{command.name}</span>
                        {command.description ? (
                          <span className="command-palette-item-desc">{command.description}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))
            : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};
