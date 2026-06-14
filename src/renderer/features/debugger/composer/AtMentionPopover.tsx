/**
 * AtMentionPopover — @文件提及自动补全弹出。
 */
import React, { useEffect, useState, useCallback } from 'react';
import './SlashCommandPopover.css'; // 复用相同样式

interface FileEntry { name: string; path: string; isDir: boolean; }
interface Props { filterText: string; onSelect: (path: string) => void; onDismiss: () => void; }

export const AtMentionPopover: React.FC<Props> = ({ filterText, onSelect, onDismiss }) => {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    // 简化实现: 用 filterText 空搜当前目录的 glob
    const load = async () => {
      setFiles([
        { name: 'src/', path: 'src/', isDir: true },
        { name: 'package.json', path: 'package.json', isDir: false },
        { name: 'README.md', path: 'README.md', isDir: false },
      ]);
    };
    void load();
  }, [filterText]);

  const filtered = files.filter((f) => f.name.toLowerCase().includes(filterText.toLowerCase()));
  const total = filtered.length;
  const clamped = Math.max(0, Math.min(selected, total - 1));

  const onKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((p) => Math.min(p + 1, total - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((p) => Math.max(p - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[clamped]) onSelect(filtered[clamped].path); }
    else if (e.key === 'Escape') { e.preventDefault(); onDismiss(); }
  }, [total, clamped, filtered, onSelect, onDismiss]);

  useEffect(() => { document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onKey]);
  if (filtered.length === 0) return null;

  return (
    <div className="slash-command-popover" role="listbox">
      {filtered.map((f, i) => (
        <div key={f.path} className={`slash-command-item${i === clamped ? ' selected' : ''}`}
          onClick={() => onSelect(f.path)} onMouseEnter={() => setSelected(i)}>
          <span className="slash-command-name">{f.isDir ? '📁' : '📄'} {f.name}</span>
          <span className="slash-command-desc">{f.path}</span>
        </div>
      ))}
    </div>
  );
};
