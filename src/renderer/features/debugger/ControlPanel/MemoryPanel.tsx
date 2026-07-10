import React, { useState } from 'react';
import { useI18n } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { useMemory } from './useMemory';
import type { MemoryWriteRequest } from '@shared/types/electron';
import './MemoryPanel.css';

const MEMORY_TYPES: Array<MemoryWriteRequest['type']> = ['user', 'feedback', 'project', 'reference'];

/**
 * Memory 面板：列出/新建/编辑/删除工作区持久记忆。
 *
 * 数据经 useMemory hook（IPC 调用集中），面板只负责渲染与交互。
 */
export const MemoryPanel: React.FC = () => {
  const { t } = useI18n();
  const { memories, selected, loading, error, scope, setScope, select, write, remove } = useMemory();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<MemoryWriteRequest>({
    scope,
    approved: true,
    name: '',
    description: '',
    type: 'project',
    content: '',
  });

  const startNew = () => {
    setDraft({ scope, approved: true, name: '', description: '', type: 'project', content: '' });
    setEditing(true);
  };

  const startEdit = () => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      scope,
      approved: true,
      description: selected.description,
      type: selected.type,
      content: selected.content,
      tags: selected.tags,
    });
    setEditing(true);
  };

  const submitDraft = async () => {
    if (!draft.name.trim() || !draft.description.trim() || !draft.content.trim()) return;
    const result = await write(draft);
    if (result.success) {
      setEditing(false);
      await select(draft.name.trim());
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (window.confirm('确认删除这条记忆？此操作不可撤销。')) await remove(selected.name);
  };

  return (
    <div className="memory-panel" data-testid="memory-panel">
      <div className="memory-panel-header">
        <span className="memory-panel-title">{t('memory.panelTitle')}</span>
        <select className="memory-panel-select" value={scope} onChange={(event) => setScope(event.target.value as 'user' | 'project')} aria-label="Memory scope"><option value="user">User</option><option value="project">Project</option></select>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={startNew} aria-label={t('memory.new')}>
            +
          </Button>
        )}
      </div>

      {error && <div className="memory-panel-error">{error}</div>}

      {editing ? (
        <div className="memory-panel-editor" data-testid="memory-editor">
          <input
            className="memory-panel-input"
            value={draft.name}
            placeholder={t('memory.namePlaceholder')}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="memory-panel-input"
            value={draft.description}
            placeholder={t('memory.descriptionPlaceholder')}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <select
            className="memory-panel-select"
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as MemoryWriteRequest['type'] })}
          >
            {MEMORY_TYPES.map((tp) => (
              <option key={tp} value={tp}>{tp}</option>
            ))}
          </select>
          <textarea
            className="memory-panel-textarea"
            value={draft.content}
            placeholder={t('memory.contentPlaceholder')}
            rows={6}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          <div className="memory-panel-editor-actions">
            <Button variant="primary" size="sm" onClick={submitDraft} disabled={!draft.name.trim() || !draft.content.trim()}>
              {t('memory.save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {t('memory.cancel')}
            </Button>
          </div>
        </div>
      ) : selected ? (
        <div className="memory-panel-detail" data-testid="memory-detail">
          <div className="memory-panel-detail-header">
            <span className="memory-panel-detail-name">{selected.name}</span>
            <span className="memory-panel-detail-type">{selected.type}</span>
          </div>
          <p className="memory-panel-detail-desc">{selected.description}</p>
          <pre className="memory-panel-detail-content">{selected.content}</pre>
          <div className="memory-panel-detail-actions">
            <Button variant="ghost" size="sm" onClick={startEdit}>{t('memory.edit')}</Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>{t('memory.delete')}</Button>
            <Button variant="ghost" size="sm" onClick={() => select(null)}>{t('memory.back')}</Button>
          </div>
        </div>
      ) : (
        <ul className="memory-panel-list" data-testid="memory-list">
          {loading && memories.length === 0 && <li className="memory-panel-empty">…</li>}
          {!loading && memories.length === 0 && (
            <li className="memory-panel-empty">{t('memory.empty')}</li>
          )}
          {memories.map((mem) => (
            <li key={mem.name}>
              <button
                type="button"
                className="memory-panel-item"
                onClick={() => select(mem.name)}
              >
                <span className="memory-panel-item-name">{mem.name}</span>
                <span className="memory-panel-item-type">{mem.type}</span>
                <span className="memory-panel-item-desc">{mem.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
