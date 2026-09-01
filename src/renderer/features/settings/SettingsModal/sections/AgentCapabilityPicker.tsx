import React, { useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';

type Translate = ReturnType<typeof useI18n>['t'];

const BUILTIN_TOOL_OPTIONS = [
  'read',
  'search',
  'web',
  'git',
  'shell',
  'interpreter',
  'write',
  'edit',
  'file-manage',
  'askUser',
  'agent',
  'handoff',
  'task',
  'memory',
  'memory-write',
  'planArtifact',
  'skill',
  'mcp',
  'tool_search',
  'rdxContext',
  'subagent',
];

const uniqueOptions = (...groups: string[][]): string[] =>
  Array.from(new Set(groups.flat().map((value) => value.trim()).filter(Boolean)))
    .sort((first, second) => first.localeCompare(second));

export const buildAgentCapabilityGroups = (
  settings: AppSettings,
  selectedAgent: AgentManifestDraft,
  onUpdateAgent: (patch: Partial<AgentManifestDraft>) => void,
  t: Translate,
): AgentCapabilityGroup[] => {
  const allAgents = settings.agents.definitions;
  return [
    {
      id: 'tools',
      label: t('settings.tools'),
      values: selectedAgent.tools,
      options: uniqueOptions(BUILTIN_TOOL_OPTIONS, allAgents.flatMap((agent) => agent.tools), selectedAgent.tools),
      onChange: (tools) => onUpdateAgent({ tools }),
    },
    {
      id: 'agents',
      label: t('settings.subAgents'),
      values: selectedAgent.agents,
      options: uniqueOptions(
        allAgents.filter((agent) => agent.id !== selectedAgent.id).map((agent) => agent.id),
        selectedAgent.agents,
      ),
      onChange: (agents) => onUpdateAgent({ agents }),
    },
    {
      id: 'skills',
      label: t('settings.skills'),
      values: selectedAgent.skills,
      options: uniqueOptions(allAgents.flatMap((agent) => agent.skills), selectedAgent.skills),
      onChange: (skills) => onUpdateAgent({ skills }),
    },
    {
      id: 'mcp',
      label: t('settings.mcp'),
      values: selectedAgent.mcpServers,
      options: uniqueOptions(allAgents.flatMap((agent) => agent.mcpServers), selectedAgent.mcpServers),
      onChange: (mcpServers) => onUpdateAgent({ mcpServers }),
    },
  ];
};

export interface AgentCapabilityGroup {
  id: string;
  label: string;
  values: string[];
  options: string[];
  onChange: (values: string[]) => void;
}

interface AgentCapabilityPickerProps {
  groups: AgentCapabilityGroup[];
  t: Translate;
}

const normalizeCapability = (value: string): string => value.trim();

const uniqueCapabilities = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalizeCapability).filter(Boolean)));

export const AgentCapabilityPicker: React.FC<AgentCapabilityPickerProps> = ({ groups, t }) => {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const setDraft = (groupId: string, value: string) => {
    setDrafts((current) => ({ ...current, [groupId]: value }));
  };

  const toggleValue = (group: AgentCapabilityGroup, option: string) => {
    const selected = new Set(group.values);
    if (selected.has(option)) {
      selected.delete(option);
    } else {
      selected.add(option);
    }
    group.onChange(uniqueCapabilities(Array.from(selected)));
  };

  const addCustomValue = (group: AgentCapabilityGroup) => {
    const next = normalizeCapability(drafts[group.id] ?? '');
    if (!next) return;
    group.onChange(uniqueCapabilities([...group.values, next]));
    setDraft(group.id, '');
  };

  return (
    <div className="settings-capability-picker">
      {groups.map((group) => {
        const options = uniqueCapabilities([...group.options, ...group.values]);
        return (
          <section key={group.id} className="settings-capability-group">
            <div className="settings-capability-group-head">
              <strong>{group.label}</strong>
              <span>{t('settings.agentCapabilitySelected', { count: String(group.values.length) })}</span>
            </div>

            <div className="settings-capability-options" role="group" aria-label={group.label}>
              {options.length > 0 ? options.map((option) => (
                <label key={option} className="settings-capability-option">
                  <input
                    type="checkbox"
                    checked={group.values.includes(option)}
                    onChange={() => toggleValue(group, option)}
                  />
                  <span>{option}</span>
                </label>
              )) : (
                <div className="settings-empty settings-empty-dashed">{t('settings.noCapabilityOptions')}</div>
              )}
            </div>

            <form
              className="settings-capability-custom"
              onSubmit={(event) => {
                event.preventDefault();
                addCustomValue(group);
              }}
            >
              <input
                className="input"
                value={drafts[group.id] ?? ''}
                placeholder={t('settings.addCapabilityPlaceholder')}
                onChange={(event) => setDraft(group.id, event.currentTarget.value)}
              />
              <button type="submit" className="button button-secondary">
                {t('settings.add')}
              </button>
            </form>
          </section>
        );
      })}
    </div>
  );
};
