import React, { useEffect, useMemo, useRef } from 'react';
import type { AgentHandoffDefinition, AgentManifestDefinition, AgentModelOption } from '@shared/types/agentManifest';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { AgentHandoffCard } from './AgentHandoffCard';
import { persistAgentHandoff, validateAgentHandoffs } from './agentHandoffValidation';

type Translate = ReturnType<typeof useI18n>['t'];

interface AgentHandoffEditorProps {
  selfId: string;
  handoffs: AgentHandoffDefinition[];
  definitions: AgentManifestDefinition[];
  modelOptions: AgentModelOption[];
  forceShowRequired: boolean;
  onChange: (handoffs: AgentHandoffDefinition[]) => void;
  t: Translate;
}

const emptyHandoff = (): AgentHandoffDefinition => ({ label: '', agent: '', prompt: '' });

const syncRowKeys = (keys: string[], count: number): string[] => {
  if (keys.length === count) return keys;
  const next = keys.slice(0, count);
  while (next.length < count) next.push(crypto.randomUUID());
  return next;
};

const swapAt = <T,>(items: T[], index: number, offset: number): T[] => {
  const next = [...items];
  const target = index + offset;
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
};

export const AgentHandoffEditor: React.FC<AgentHandoffEditorProps> = ({
  selfId,
  handoffs,
  definitions,
  modelOptions,
  forceShowRequired,
  onChange,
  t,
}) => {
  const rowKeysRef = useRef<string[]>([]);
  const pendingFocusRef = useRef<{ key: string; target: 'label' | 'delete' | 'add' } | null>(null);
  const addRef = useRef<HTMLButtonElement | null>(null);
  const labelRefs = useRef(new Map<string, HTMLInputElement>());
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  rowKeysRef.current = syncRowKeys(rowKeysRef.current, handoffs.length);
  const rowKeys = rowKeysRef.current;
  const targets = useMemo(
    () => definitions
      .filter((agent) => agent.enabled && agent.id !== selfId)
      .slice()
      .sort((first, second) => first.name.localeCompare(second.name)),
    [definitions, selfId],
  );
  const issues = validateAgentHandoffs(handoffs, { selfId, definitions, modelOptions });

  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    if (pending.target === 'add') addRef.current?.focus();
    else if (pending.target === 'delete') deleteRefs.current.get(pending.key)?.focus();
    else labelRefs.current.get(pending.key)?.focus();
  });

  const commit = (next: AgentHandoffDefinition[], keys: string[]) => {
    rowKeysRef.current = keys;
    onChange(next);
  };

  const addHandoff = () => {
    const key = crypto.randomUUID();
    pendingFocusRef.current = { key, target: 'label' };
    commit([...handoffs, emptyHandoff()], [...rowKeysRef.current, key]);
  };

  const removeHandoff = (index: number) => {
    const previousKey = rowKeysRef.current[index - 1];
    pendingFocusRef.current = previousKey
      ? { key: previousKey, target: 'delete' }
      : { key: 'add', target: 'add' };
    commit(
      handoffs.filter((_, current) => current !== index),
      rowKeysRef.current.filter((_, current) => current !== index),
    );
  };

  return (
    <div className="settings-handoff-editor" data-testid="settings-agent-handoffs">
      {handoffs.length === 0 ? (
        <div className="settings-empty settings-empty-dashed">{t('settings.agentHandoffEmpty')}</div>
      ) : (
        <div className="settings-handoff-list">
          {handoffs.map((handoff, index) => {
            const rowKey = rowKeys[index] ?? String(index);
            return (
              <AgentHandoffCard
                key={rowKey}
                index={index}
                handoff={handoff}
                issues={issues.filter((issue) => issue.index === index)}
                targets={targets}
                modelOptions={modelOptions}
                forceShowRequired={forceShowRequired}
                isFirst={index === 0}
                isLast={index === handoffs.length - 1}
                t={t}
                onChange={(next) => commit(handoffs.map((entry, current) => (
                  current === index ? persistAgentHandoff(next) : entry
                )), rowKeysRef.current)}
                onMoveUp={() => commit(swapAt(handoffs, index, -1), swapAt(rowKeysRef.current, index, -1))}
                onMoveDown={() => commit(swapAt(handoffs, index, 1), swapAt(rowKeysRef.current, index, 1))}
                onDelete={() => removeHandoff(index)}
                labelRef={(node) => {
                  if (node) labelRefs.current.set(rowKey, node);
                  else labelRefs.current.delete(rowKey);
                }}
                deleteRef={(node) => {
                  if (node) deleteRefs.current.set(rowKey, node);
                  else deleteRefs.current.delete(rowKey);
                }}
              />
            );
          })}
        </div>
      )}
      <div className="settings-handoff-add">
        <Button ref={addRef} variant="secondary" onClick={addHandoff}>
          {t('settings.agentHandoffAdd')}
        </Button>
      </div>
    </div>
  );
};
