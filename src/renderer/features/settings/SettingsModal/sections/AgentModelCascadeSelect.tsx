import React, { useMemo } from 'react';
import type { AgentModelOption } from '@shared/types/agentManifest';

interface AgentModelCascadeSelectProps {
  value: string;
  options: AgentModelOption[];
  onChange: (value: string) => void;
}

export const AgentModelCascadeSelect: React.FC<AgentModelCascadeSelectProps> = ({ value, options, onChange }) => {
  const groups = useMemo(() => {
    const map = new Map<string, AgentModelOption[]>();
    for (const option of options) {
      const current = map.get(option.providerId) ?? [];
      current.push(option);
      map.set(option.providerId, current);
    }
    return Array.from(map.entries()).map(([providerId, providerOptions]) => ({
      providerId,
      label: providerOptions[0]?.providerLabel || providerId,
      options: providerOptions,
    }));
  }, [options]);
  const selected = options.find((option) => option.canonicalId === value);

  return (
    <div className="settings-model-cascade">
      <button type="button" className="settings-model-cascade-trigger">
        <span>{selected ? selected.providerLabel : '选择模型'}</span>
        <strong>{selected ? selected.modelLabel : '未设置'}</strong>
      </button>
      <div className="settings-model-cascade-menu" role="menu">
        {groups.map((group) => (
          <div key={group.providerId} className="settings-model-provider-group">
            <button type="button" className="settings-model-provider-trigger">
              <span>{group.label}</span>
              <span>{group.options.filter((option) => option.configured).length}</span>
            </button>
            <div className="settings-model-submenu">
              {group.options.map((option) => (
                <button
                  key={option.canonicalId}
                  type="button"
                  className={`settings-model-option ${option.canonicalId === value ? 'active' : ''}`}
                  disabled={!option.configured}
                  onClick={() => onChange(option.canonicalId)}
                >
                  <span>{option.modelLabel}</span>
                  <small>{option.canonicalId}</small>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
