import React, { useState } from 'react';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings } from '@shared/types/settings';
import type { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { CheckPill } from '../../../../ui/CheckPill';
import { EmptyState } from '../../../../ui/EmptyState';
import { Input } from '../../../../ui/Input';
import { AgentSkillPicker, type AgentSkillCatalog } from './AgentSkillPicker';

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
  'rdcContext',
  'subagent',
];

/** Display-only grouping of builtin tool ids; the ids themselves are the real tool tokens. */
const TOOL_SUBGROUPS: Array<{ id: 'read' | 'execute' | 'collaborate'; tools: readonly string[] }> = [
  { id: 'read', tools: ['read', 'search', 'web', 'git', 'rdcContext', 'tool_search', 'memory', 'skill', 'mcp', 'planArtifact'] },
  { id: 'execute', tools: ['shell', 'interpreter', 'write', 'edit', 'file-manage', 'memory-write'] },
  { id: 'collaborate', tools: ['agent', 'subagent', 'handoff', 'task', 'askUser'] },
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
      subgroups: TOOL_SUBGROUPS.map((subgroup) => ({
        id: subgroup.id,
        label: t(`settings.agentToolGroup.${subgroup.id}` as const),
        match: (option: string) => subgroup.tools.includes(option),
      })),
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
      options: [],
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
  /** Optional display partition; options matching no subgroup land in a trailing 'other' bucket. */
  subgroups?: Array<{ id: string; label: string; match: (option: string) => boolean }>;
  onChange: (values: string[]) => void;
}

interface AgentCapabilityPickerProps {
  skills: AgentSkillCatalog;
  targetAgentId: string;
  groups: AgentCapabilityGroup[];
  t: Translate;
}

const normalizeCapability = (value: string): string => value.trim();

const uniqueCapabilities = (values: string[]): string[] =>
  Array.from(new Set(values.map(normalizeCapability).filter(Boolean)));

function partition(group: AgentCapabilityGroup, options: string[]): Array<{ id: string; label: string | null; options: string[] }> {
  const subgroups = group.subgroups ?? [];
  if (subgroups.length === 0) return [{ id: 'all', label: null, options }];
  const buckets: Array<{ id: string; label: string | null; options: string[] }> = subgroups
    .map((subgroup) => ({ id: subgroup.id, label: subgroup.label, options: options.filter(subgroup.match) }));
  const rest = options.filter((option) => !subgroups.some((subgroup) => subgroup.match(option)));
  if (rest.length) buckets.push({ id: 'other', label: null, options: rest });
  return buckets.filter((bucket) => bucket.options.length > 0);
}

export const AgentCapabilityPicker: React.FC<AgentCapabilityPickerProps> = ({ groups, skills, targetAgentId, t }) => {
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
      <p className="settings-capability-note">{t('settings.agentCapabilityNotGrantHint')}</p>
      {groups.map((group) => {
        if (group.id === 'skills') return <section key={group.id} className="settings-capability-group">
          <AgentSkillPicker skills={skills} targetAgentId={targetAgentId} value={group.values} onChange={group.onChange} t={t} />
        </section>;
        const options = uniqueCapabilities([...group.options, ...group.values]);
        return (
          <section key={group.id} className="settings-capability-group">
            <div className="settings-capability-group-head">
              <strong>{group.label}</strong>
              <span>{t('settings.agentCapabilitySelected', { count: String(group.values.length) })}</span>
            </div>

            {options.length === 0 ? (
              <EmptyState className="settings-capability-empty" title={t('settings.noCapabilityOptions')} />
            ) : partition(group, options).map((bucket) => (
              <div key={bucket.id} className="settings-capability-bucket">
                {bucket.label ? <div className="settings-capability-bucket-title">{bucket.label}</div> : null}
                <div className="settings-capability-options" role="group" aria-label={bucket.label ?? group.label}>
                  {bucket.options.map((option) => (
                    <CheckPill
                      key={option}
                      checked={group.values.includes(option)}
                      onCheckedChange={() => toggleValue(group, option)}
                      data-testid={`settings-capability-${group.id}-${option}`}
                    >
                      {option}
                    </CheckPill>
                  ))}
                </div>
              </div>
            ))}

            <form
              className="settings-capability-custom"
              onSubmit={(event) => {
                event.preventDefault();
                addCustomValue(group);
              }}
            >
              <Input
                inputSize="sm"
                value={drafts[group.id] ?? ''}
                placeholder={t('settings.addCapabilityPlaceholder')}
                aria-label={t('settings.addCapabilityPlaceholder')}
                onChange={(event) => setDraft(group.id, event.currentTarget.value)}
              />
              <Button type="submit" variant="ghost" size="sm">{t('settings.add')}</Button>
            </form>
          </section>
        );
      })}
    </div>
  );
};
