import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useCommandCatalog } from '../../hooks/useCommandCatalog';
import { useI18n } from '../../i18n';
import { useOverlayLayer } from '../../lib/overlayStack';
import { useDismissable } from '../../lib/useDismissable';
import { isImeComposing } from '../../lib/ime';
import { InlineError } from '../../ui/InlineError';
import { Skeleton } from '../../ui/Skeleton';
import './SlashCommandPopover.css';

interface SlashCommandPopoverProps {
  filterText: string;
  onSelect: (commandName: string) => void;
  onDismiss: () => void;
}

/**
 * Commands for what was typed after "/", grouped by category the way the model picker groups providers: a caption,
 * then rows of name and one line of description. Arrow keys move, Enter picks, Escape closes.
 */
export const SlashCommandPopover: React.FC<SlashCommandPopoverProps> = ({ filterText, onSelect, onDismiss }) => {
  const { t } = useI18n();
  const { commands, loading, error } = useCommandCatalog();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const query = filterText.toLowerCase();
  const filtered = useMemo(() => commands.filter((command) =>
    command.name.startsWith(query) || command.aliases.some((alias) => alias.startsWith(query))), [commands, query]);
  const groups = useMemo(() => {
    const byCategory = new Map<string, typeof filtered>();
    for (const command of filtered) byCategory.set(command.categoryLabel, [...(byCategory.get(command.categoryLabel) ?? []), command]);
    return [...byCategory.entries()];
  }, [filtered]);
  const ordered = useMemo(() => groups.flatMap(([, entries]) => entries), [groups]);

  useEffect(() => setSelectedIndex(0), [filterText]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // An input method's Enter commits its candidate; it must not also pick a command.
    if (isImeComposing(event)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((previous) => Math.min(previous + 1, ordered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((previous) => Math.max(previous - 1, 0));
    } else if (event.key === 'Enter' && ordered[selectedIndex]) {
      event.preventDefault();
      onSelect(ordered[selectedIndex].name);
    }
  }, [ordered, selectedIndex, onSelect]);

  const listed = ordered.length > 0 && !loading && !error;
  const { layerId } = useOverlayLayer(listed);
  useDismissable({ open: listed, layerId, onDismiss });

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (loading) return <div className="slash-command-popover" role="status"><Skeleton shape="row" count={3} /></div>;
  if (error) return <div className="slash-command-popover"><InlineError detail={error}>{t('app.commandsFailed')}</InlineError></div>;
  if (ordered.length === 0) return null;

  return (
    <div className="slash-command-popover" role="listbox" aria-label={t('composer.slashCommands')}>
      {groups.map(([category, entries]) => (
        <div key={category} className="slash-command-group" role="group" aria-label={category}>
          <p className="slash-command-group-label">{category}</p>
          {entries.map((command) => {
            const index = ordered.indexOf(command);
            return (
              <div key={command.id} className={`slash-command-item${index === selectedIndex ? ' is-selected' : ''}`}
                role="option" aria-selected={index === selectedIndex}
                onClick={() => onSelect(command.name)} onMouseEnter={() => setSelectedIndex(index)}>
                <span className="slash-command-name">/{command.name}</span>
                {command.description ? <span className="slash-command-desc">{command.description}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};
