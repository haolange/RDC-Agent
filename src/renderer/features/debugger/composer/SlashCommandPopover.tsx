/**
 * SlashCommandPopover — 斜杠命令弹出选择器。
 *
 * 当用户在输入框中输入 "/" 时显示可用命令列表，
 * 支持键盘导航（上下箭头 / Enter / Escape）和鼠标选择。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CommandListResult } from '@shared/types/command';
import './SlashCommandPopover.css';

type CommandItem = CommandListResult['commands'][number];

interface SlashCommandPopoverProps {
  filterText: string;
  onSelect: (commandName: string) => void;
  onDismiss: () => void;
}

export const SlashCommandPopover: React.FC<SlashCommandPopoverProps> = ({
  filterText,
  onSelect,
  onDismiss,
}) => {
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const api = (window as { electronAPI?: { command?: { list: (category?: string) => Promise<CommandListResult> } } }).electronAPI;

  useEffect(() => {
    const loadCommands = async () => {
      if (!api?.command) return;
      const result = await api.command.list();
      setCommands(result.commands);
    };
    void loadCommands();
  }, [api?.command]);

  const filtered = commands.filter(
    (c) =>
      c.name.startsWith(filterText.toLowerCase()) ||
      c.aliases.some((a) => a.startsWith(filterText.toLowerCase())),
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [filterText]);

  // 键盘导航
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex].name);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onDismiss();
          break;
      }
    },
    [filtered, selectedIndex, onSelect, onDismiss],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (filtered.length === 0) return null;

  return (
    <div className="slash-command-popover" ref={containerRef} role="listbox">
      {filtered.map((cmd, idx) => (
        <div
          key={cmd.id}
          className={`slash-command-item${idx === selectedIndex ? ' selected' : ''}`}
          role="option"
          aria-selected={idx === selectedIndex}
          title={cmd.description}
          onClick={() => onSelect(cmd.name)}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <span className="slash-command-name">/{cmd.name}</span>
          <span className="slash-command-desc">{cmd.description}</span>
          <span className="slash-command-cat">{cmd.category}</span>
        </div>
      ))}
      <div className="slash-command-footer">
        <kbd>↑↓</kbd> navigate <kbd>Enter</kbd> select <kbd>Esc</kbd> dismiss
      </div>
    </div>
  );
};
